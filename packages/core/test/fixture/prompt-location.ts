import type { FileSystem } from "@nemoracode/core/filesystem"
import { Bus } from "@nemoracode/core/bus"
import { Image } from "@nemoracode/core/image"
import { LocationServiceMap } from "@nemoracode/core/location-service-map"
import type { LocationServices } from "@nemoracode/core/location-services"
import { Plugin } from "@nemoracode/core/plugin"
import { PluginHooks } from "@nemoracode/core/plugin/hooks"
import { Skill } from "@nemoracode/core/skill"
import type { Location } from "@nemoracode/schema/location"
import { makeGlobalNode } from "@nemoracode/util/effect/app-node"
import { LayerNode } from "@nemoracode/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})
