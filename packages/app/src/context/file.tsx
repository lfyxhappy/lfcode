import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@lfcode-ai/ui/context"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: (dir) => sdk.client.file.list({ path: dir }).then((x) => x.data ?? []),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const normalizeReferencePath = (input: string) => {
      if (/^[A-Za-z]:[\\/]*$/u.test(input)) return input.slice(0, 2) + "\\"
      if (/^[\\/]+$/u.test(input)) return "/"
      return input.replace(/[\\/]+$/u, "")
    }
    const canonicalReferencePath = (input: string) => {
      const normalized = normalizeReferencePath(input).replace(/\\/g, "/")
      return /^[A-Za-z]:/u.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized
    }
    const referenceGrants = new Map<string, string>()
    const referenceToken = (input: string) => {
      const target = canonicalReferencePath(input)
      return [...referenceGrants.entries()]
        .sort(([left], [right]) => right.length - left.length)
        .find(([root]) => target === root || target.startsWith(root.endsWith("/") ? root : root + "/"))?.[1]
    }
    const referenceTree = createFileTreeStore({
      scope: () => layout.fileTree.referencePath() ?? "",
      normalizeDir: normalizeReferencePath,
      list: (dir) => {
        const token = referenceToken(dir)
        return sdk.client.file.referenceTree({ path: dir, token }).then((x) => x.data ?? [])
      },
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      inflight.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    createEffect(
      on(
        () => layout.fileTree.referencePath(),
        (target) => {
          referenceTree.reset()
          if (target) void referenceTree.listDir(target)
        },
        { defer: true },
      ),
    )

    createEffect(
      on(
        scope,
        () => {
          referenceGrants.clear()
          referenceTree.reset()
          layout.fileTree.clearReference()
        },
        { defer: true },
      ),
    )

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()
      startWatching()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)

      const promise = sdk.client.file
        .read({ path: file, reference_token: referenceToken(file) })
        .then((x) => {
          if (scope() !== directory) return
          const content = x.data
          setLoaded(file, content)

          if (!content) return
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (scope() !== directory) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query, dirs }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )

    const write = (input: {
      path: string
      content: string
      expectedChecksum?: string
      createParents?: boolean
    }) => {
      const file = path.normalize(input.path)
      if (!file) {
        return Promise.reject(new Error("Invalid file path"))
      }

      startWatching()
      ensure(file)
      return sdk.client.file
        .write({
          path: file,
          content: input.content,
          expectedChecksum: input.expectedChecksum,
          createParents: input.createParents,
        })
        .then((x) => {
          const content = x.data
          if (!content) return content
          setLoaded(file, content)
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
          return content
        })
    }

    let stop: VoidFunction | undefined
    const startWatching = () => {
      if (stop) return
      stop = sdk.event.listen((e) => {
        invalidateFromWatcher(e.details, {
          normalize: path.normalize,
          hasFile: (file) => Boolean(store.file[file]),
          isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
          loadFile: (file) => {
            void load(file, { force: true })
          },
          node: tree.node,
          isDirLoaded: tree.isLoaded,
          refreshDir: (dir) => {
            void tree.listDir(dir, { force: true })
          },
        })
      })
    }

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    function withPath(input: string, action: (file: string) => unknown) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop?.()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      tree: {
        list(input: string) {
          startWatching()
          return tree.listDir(input)
        },
        refresh(input: string) {
          startWatching()
          return tree.listDir(input, { force: true })
        },
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      referenceTree: {
        authorize(root: string, token: string) {
          referenceGrants.set(canonicalReferencePath(root), token)
        },
        list: referenceTree.listDir,
        refresh(input: string) {
          return referenceTree.listDir(input, { force: true })
        },
        state: referenceTree.dirState,
        children: referenceTree.children,
        expand: referenceTree.expandDir,
        collapse: referenceTree.collapseDir,
        normalize: normalizeReferencePath,
        reset: referenceTree.reset,
      },
      get,
      load,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      write,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
    }
  },
})
