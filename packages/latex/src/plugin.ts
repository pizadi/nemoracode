import { Plugin } from "@nemoracode/plugin/tui"
import { createLatexCodeBlockRenderer } from "./markdown"

export default Plugin.define({
  id: "nemoracode.latex",
  setup(context) {
    const render = createLatexCodeBlockRenderer(context.renderer, () => ({
      text: context.theme.text.base,
      subdued: context.theme.text.muted,
    }))
    context.markdown.registerCodeBlockRenderer("latex", render)
    context.markdown.registerCodeBlockRenderer("math", render)
  },
})
