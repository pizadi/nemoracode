// The graph store indexes local project files, which the workerd runtime never sees.
export const graphParserWasm: Record<string, string> = new Proxy(
  {},
  {
    get: () => {
      throw new Error("tree-sitter grammars are not available on this runtime")
    },
  },
)
