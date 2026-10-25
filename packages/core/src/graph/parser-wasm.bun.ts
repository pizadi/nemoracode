// @ts-ignore Bun embeds static file imports when compiling the CLI.
import runtime from "web-tree-sitter/tree-sitter.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import python from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import c from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import cpp from "tree-sitter-cpp/tree-sitter-cpp.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import typescript from "tree-sitter-typescript/tree-sitter-typescript.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import tsx from "tree-sitter-typescript/tree-sitter-tsx.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import rust from "tree-sitter-rust/tree-sitter-rust.wasm" with { type: "file" }

export const graphParserWasm = { runtime, python, c, cpp, typescript, tsx, rust } as Record<string, string>
