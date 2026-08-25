import { z } from "zod"

export type ActionDefinition<Input = unknown, Output = unknown> = {
  input: z.ZodType<Input>
  execute(input: Input): Promise<Output>
}

export function action<Input, Output>(input: ActionDefinition<Input, Output>) {
  return input
}

action.schema = z
