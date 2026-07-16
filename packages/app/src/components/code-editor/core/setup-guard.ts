export function isCurrentCodeEditorSetup(input: {
  token: number
  currentToken: number
  path: string
  currentPath: string
}) {
  return input.token === input.currentToken && input.path === input.currentPath
}
