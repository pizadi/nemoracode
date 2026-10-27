import { Effect } from "effect"
import { define } from "@nemoracode/plugin/effect/plugin"

export const KiloPlugin = define({
  id: "nemoracode.provider.kilo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@nemoracode/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://api.kilo.ai/api/gateway") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "HTTP-Referer": "https://opencode.ai/", "X-Title": "nemoracode" }
        })
      }
    })
  }),
})
