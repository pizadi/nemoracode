import { Plugin } from "@nemoracode/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveNemoraCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "nemoracode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveNemoraCodeDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
