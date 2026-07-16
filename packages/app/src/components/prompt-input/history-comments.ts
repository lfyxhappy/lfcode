import type { LineComment } from "@/context/comments"
import type { SelectedLineRange } from "@/context/file"
import type { FileContextItem } from "@/context/prompt"
import { selectionFromLines } from "@/context/file/types"
import type { PromptHistoryComment } from "./history"

type PromptHistoryContextItem = Pick<
  FileContextItem,
  "type" | "path" | "selection" | "comment" | "commentID" | "commentOrigin" | "preview"
> & {
  key?: string
}

export function collectPromptHistoryComments(items: PromptHistoryContextItem[], comments: LineComment[], now = Date.now) {
  const byID = new Map(comments.map((item) => [`${item.file}\n${item.id}`, item] as const))

  return items.flatMap((item) => {
    if (item.type !== "file") return []

    const comment = item.comment?.trim()
    if (!comment) return []

    const existing = item.commentID ? byID.get(`${item.path}\n${item.commentID}`) : undefined
    const selection = existing?.selection ?? selectionRangeFromContext(item.selection)
    if (!selection) return []

    return [
      {
        id: item.commentID ?? item.key ?? `${item.path}\n${selection.start}\n${selection.end}`,
        path: item.path,
        selection,
        comment,
        time: item.commentID ? (existing?.time ?? now()) : now(),
        origin: item.commentOrigin,
        preview: item.preview,
      } satisfies PromptHistoryComment,
    ]
  })
}

export function restorePromptHistoryComments(items: PromptHistoryComment[]) {
  return {
    comments: items.map((item) => ({
      id: item.id,
      file: item.path,
      selection: { ...item.selection },
      comment: item.comment,
      time: item.time,
    })),
    contextItems: items.map((item) => ({
      type: "file" as const,
      path: item.path,
      selection: selectionFromLines(item.selection),
      comment: item.comment,
      commentID: item.id,
      commentOrigin: item.origin,
      preview: item.preview,
    })),
  }
}

function selectionRangeFromContext(selection?: FileContextItem["selection"]): SelectedLineRange | undefined {
  if (!selection) return
  return {
    start: selection.startLine,
    end: selection.endLine,
  }
}
