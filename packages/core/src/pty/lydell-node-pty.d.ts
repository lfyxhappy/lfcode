declare module "@lydell/node-pty" {
  export function spawn(
    file: string,
    args: string[],
    options: import("./pty").Opts,
  ): import("./pty").Proc
}
