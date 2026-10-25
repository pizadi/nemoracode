import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export const graphParserWasm = {
  runtime: require.resolve("web-tree-sitter/tree-sitter.wasm"),
  python: require.resolve("tree-sitter-python/tree-sitter-python.wasm"),
  c: require.resolve("tree-sitter-c/tree-sitter-c.wasm"),
  cpp: require.resolve("tree-sitter-cpp/tree-sitter-cpp.wasm"),
  typescript: require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"),
  tsx: require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"),
  rust: require.resolve("tree-sitter-rust/tree-sitter-rust.wasm"),
} as Record<string, string>
