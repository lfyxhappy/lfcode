import { createContext, useContext, type ParentProps } from "solid-js"
import type { AppIconProps } from "../components/app-icon"
import type { FileReferenceKind } from "../components/file-reference-path"

export type FileReferenceApp = {
  id: string
  label: string
  icon?: AppIconProps["id"]
  openWith: string
}

export type FileReferenceContextValue = {
  baseDir?: string
  canOpenPaths?: boolean
  canExternalOpenPaths?: boolean
  enableMarkdownDecorations?: boolean
  allowContextMenu?: boolean
  resolvePath?: (value: string, baseDir?: string) => string | undefined
  openWithApps?: FileReferenceApp[]
  onPreviewPath?: (path: string) => void
  onOpenDefaultApp?: (path: string) => void
  onOpenFolder?: (path: string) => void
  onOpenWith?: (path: string, app: string) => void
  onCopyPath?: (path: string) => void
  onReviewPath?: (path: string) => void
  inferKind?: (value: string) => FileReferenceKind
}

const FileReferenceContext = createContext<FileReferenceContextValue | undefined>()

export function FileReferenceProvider(props: ParentProps<{ value: FileReferenceContextValue }>) {
  return <FileReferenceContext.Provider value={props.value}>{props.children}</FileReferenceContext.Provider>
}

export function useFileReferenceContext() {
  return useContext(FileReferenceContext)
}
