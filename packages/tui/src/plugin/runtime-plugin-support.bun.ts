import { ensurePluginRuntime, provides } from "@nemoracode/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@nemoracode/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@nemoracode/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
