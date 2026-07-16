import z from "zod"

export const InteractiveHtml = z.object({
  mode: z.literal("interactive-html"),
  message: z.string().optional(),
})

export const Info = z.discriminatedUnion("mode", [InteractiveHtml]).meta({
  ref: "SessionInteraction",
})
export type Info = z.infer<typeof Info>

const INTERACTIVE_HTML_BLOCK = /(^|\n)```(?:lfcode-html|<<lfcode>>-<<html>>)[^\n]*\n[\s\S]*?\n```(?=\n|$)/

export function containsInteractiveHtmlBlock(input: string) {
  return INTERACTIVE_HTML_BLOCK.test(input)
}

export const SessionInteraction = {
  InteractiveHtml,
  Info,
  containsInteractiveHtmlBlock,
}
