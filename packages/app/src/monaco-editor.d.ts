declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor"
  import * as monaco from "monaco-editor"
  export default monaco
}

declare module "monaco-editor/esm/vs/editor/editor.all" {}

declare module "monaco-editor/esm/vs/language/*/monaco.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/bat/bat.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/go/go.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/ini/ini.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/java/java.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/lua/lua.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/php/php.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/python/python.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/r/r.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/rust/rust.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/scala/scala.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/shell/shell.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/sql/sql.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/swift/swift.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/xml/xml.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution" {}
declare module "solid-js/web/dist/web.js" {
  export * from "solid-js/web"
}

declare module "*?worker" {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}
