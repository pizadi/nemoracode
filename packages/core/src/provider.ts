export * as Provider from "./provider.js"

import { Context, Effect, Layer, Option, Schema, Stream, Struct } from "effect"
import { Provider } from "@nemoracode/schema/provider"
import { Model } from "@nemoracode/schema/model"
import { makeLocationNode } from "@nemoracode/util/effect/app-node"
import { HttpTimeout, type ProviderPackageDefinition } from "@nemoracode/ai/effect"
import { isRecord } from "@nemoracode/ai/utils/record"
import { Npm } from "@nemoracode/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@nemoracode/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@nemoracode/schema/credential"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK_PREFIX = "aisdk:"
export const isAISDK = (value: string | undefined): value is string => value?.startsWith(AISDK_PREFIX) ?? false
export const aisdk = (value: string) => (isAISDK(value) ? value : `${AISDK_PREFIX}${value}`)
export function packageName(value: string): string
export function packageName(value: undefined): undefined
export function packageName(value: string | undefined): string | undefined
export function packageName(value: string | undefined) {
  // Native provider entrypoints can persist in user configuration across the npm scope migration.
  if (value?.startsWith("@opencode-ai/ai/")) return value.replace("@opencode-ai/", "@nemoracode/")
  if (value === undefined || !isAISDK(value)) return value
  return value.slice(AISDK_PREFIX.length)
}

type Json = Schema.Schema.Type<typeof Schema.Json>
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const decodeJsonRecord = Schema.decodeUnknownSync(JsonRecord)

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}
export type ProviderPackage = ProviderPackageDefinition

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@nemoracode/ai/providers/alibaba", () => import("@nemoracode/ai/providers/alibaba")],
  ["@nemoracode/ai/providers/alibaba/chat", () => import("@nemoracode/ai/providers/alibaba/chat")],
  ["@nemoracode/ai/providers/alibaba/messages", () => import("@nemoracode/ai/providers/alibaba/messages")],
  ["@nemoracode/ai/providers/alibaba/responses", () => import("@nemoracode/ai/providers/alibaba/responses")],
  ["@nemoracode/ai/providers/amazon-bedrock", () => import("@nemoracode/ai/providers/amazon-bedrock")],
  ["@nemoracode/ai/providers/amazon-bedrock/mantle", () => import("@nemoracode/ai/providers/amazon-bedrock/mantle")],
  [
    "@nemoracode/ai/providers/amazon-bedrock/mantle/chat",
    () => import("@nemoracode/ai/providers/amazon-bedrock/mantle/chat"),
  ],
  [
    "@nemoracode/ai/providers/amazon-bedrock/mantle/messages",
    () => import("@nemoracode/ai/providers/amazon-bedrock/mantle/messages"),
  ],
  [
    "@nemoracode/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@nemoracode/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@nemoracode/ai/providers/amazon-bedrock-mantle", () => import("@nemoracode/ai/providers/amazon-bedrock-mantle")],
  ["@nemoracode/ai/providers/anthropic", () => import("@nemoracode/ai/providers/anthropic")],
  ["@nemoracode/ai/providers/anthropic-compatible", () => import("@nemoracode/ai/providers/anthropic-compatible")],
  ["@nemoracode/ai/providers/azure", () => import("@nemoracode/ai/providers/azure")],
  ["@nemoracode/ai/providers/azure/chat", () => import("@nemoracode/ai/providers/azure/chat")],
  ["@nemoracode/ai/providers/azure/responses", () => import("@nemoracode/ai/providers/azure/responses")],
  ["@nemoracode/ai/providers/baseten", () => import("@nemoracode/ai/providers/baseten")],
  ["@nemoracode/ai/providers/cerebras", () => import("@nemoracode/ai/providers/cerebras")],
  ["@nemoracode/ai/providers/cloudflare-ai-gateway", () => import("@nemoracode/ai/providers/cloudflare-ai-gateway")],
  ["@nemoracode/ai/providers/cloudflare-workers-ai", () => import("@nemoracode/ai/providers/cloudflare-workers-ai")],
  ["@nemoracode/ai/providers/cohere", () => import("@nemoracode/ai/providers/cohere")],
  ["@nemoracode/ai/providers/cohere/chat", () => import("@nemoracode/ai/providers/cohere/chat")],
  ["@nemoracode/ai/providers/deepinfra", () => import("@nemoracode/ai/providers/deepinfra")],
  ["@nemoracode/ai/providers/deepseek", () => import("@nemoracode/ai/providers/deepseek")],
  ["@nemoracode/ai/providers/digitalocean", () => import("@nemoracode/ai/providers/digitalocean")],
  ["@nemoracode/ai/providers/fireworks", () => import("@nemoracode/ai/providers/fireworks")],
  ["@nemoracode/ai/providers/google", () => import("@nemoracode/ai/providers/google")],
  ["@nemoracode/ai/providers/google/interactions", () => import("@nemoracode/ai/providers/google/interactions")],
  ["@nemoracode/ai/providers/google-vertex", () => import("@nemoracode/ai/providers/google-vertex")],
  ["@nemoracode/ai/providers/google-vertex/chat", () => import("@nemoracode/ai/providers/google-vertex/chat")],
  ["@nemoracode/ai/providers/google-vertex/gemini", () => import("@nemoracode/ai/providers/google-vertex/gemini")],
  [
    "@nemoracode/ai/providers/google-vertex/interactions",
    () => import("@nemoracode/ai/providers/google-vertex/interactions"),
  ],
  ["@nemoracode/ai/providers/google-vertex/messages", () => import("@nemoracode/ai/providers/google-vertex/messages")],
  ["@nemoracode/ai/providers/google-vertex/mistral", () => import("@nemoracode/ai/providers/google-vertex/mistral")],
  ["@nemoracode/ai/providers/google-vertex/responses", () => import("@nemoracode/ai/providers/google-vertex/responses")],
  ["@nemoracode/ai/providers/google-vertex-chat", () => import("@nemoracode/ai/providers/google-vertex-chat")],
  [
    "@nemoracode/ai/providers/google-vertex-interactions",
    () => import("@nemoracode/ai/providers/google-vertex-interactions"),
  ],
  ["@nemoracode/ai/providers/google-vertex-messages", () => import("@nemoracode/ai/providers/google-vertex-messages")],
  ["@nemoracode/ai/providers/google-vertex-mistral", () => import("@nemoracode/ai/providers/google-vertex-mistral")],
  ["@nemoracode/ai/providers/google-vertex-responses", () => import("@nemoracode/ai/providers/google-vertex-responses")],
  ["@nemoracode/ai/providers/groq", () => import("@nemoracode/ai/providers/groq")],
  ["@nemoracode/ai/providers/meta", () => import("@nemoracode/ai/providers/meta")],
  ["@nemoracode/ai/providers/meta/chat", () => import("@nemoracode/ai/providers/meta/chat")],
  ["@nemoracode/ai/providers/meta/messages", () => import("@nemoracode/ai/providers/meta/messages")],
  ["@nemoracode/ai/providers/meta/responses", () => import("@nemoracode/ai/providers/meta/responses")],
  ["@nemoracode/ai/providers/minimax", () => import("@nemoracode/ai/providers/minimax")],
  ["@nemoracode/ai/providers/minimax/chat", () => import("@nemoracode/ai/providers/minimax/chat")],
  ["@nemoracode/ai/providers/minimax/messages", () => import("@nemoracode/ai/providers/minimax/messages")],
  ["@nemoracode/ai/providers/minimax/responses", () => import("@nemoracode/ai/providers/minimax/responses")],
  ["@nemoracode/ai/providers/mistral", () => import("@nemoracode/ai/providers/mistral")],
  ["@nemoracode/ai/providers/moonshot", () => import("@nemoracode/ai/providers/moonshot")],
  ["@nemoracode/ai/providers/moonshot/chat", () => import("@nemoracode/ai/providers/moonshot/chat")],
  ["@nemoracode/ai/providers/moonshot/messages", () => import("@nemoracode/ai/providers/moonshot/messages")],
  ["@nemoracode/ai/providers/moonshot/responses", () => import("@nemoracode/ai/providers/moonshot/responses")],
  ["@nemoracode/ai/providers/openai", () => import("@nemoracode/ai/providers/openai")],
  ["@nemoracode/ai/providers/openai/chat", () => import("@nemoracode/ai/providers/openai/chat")],
  ["@nemoracode/ai/providers/openai/responses", () => import("@nemoracode/ai/providers/openai/responses")],
  ["@nemoracode/ai/providers/openai-compatible", () => import("@nemoracode/ai/providers/openai-compatible")],
  [
    "@nemoracode/ai/providers/openai-compatible/responses",
    () => import("@nemoracode/ai/providers/openai-compatible/responses"),
  ],
  [
    "@nemoracode/ai/providers/openai-compatible-responses",
    () => import("@nemoracode/ai/providers/openai-compatible-responses"),
  ],
  ["@nemoracode/ai/providers/openrouter", () => import("@nemoracode/ai/providers/openrouter")],
  ["@nemoracode/ai/providers/togetherai", () => import("@nemoracode/ai/providers/togetherai")],
  ["@nemoracode/ai/providers/venice", () => import("@nemoracode/ai/providers/venice")],
  ["@nemoracode/ai/providers/vercel-ai-gateway", () => import("@nemoracode/ai/providers/vercel-ai-gateway")],
  ["@nemoracode/ai/providers/vercel-ai-gateway/chat", () => import("@nemoracode/ai/providers/vercel-ai-gateway/chat")],
  [
    "@nemoracode/ai/providers/vercel-ai-gateway/messages",
    () => import("@nemoracode/ai/providers/vercel-ai-gateway/messages"),
  ],
  [
    "@nemoracode/ai/providers/vercel-ai-gateway/responses",
    () => import("@nemoracode/ai/providers/vercel-ai-gateway/responses"),
  ],
  ["@nemoracode/ai/providers/xai", () => import("@nemoracode/ai/providers/xai")],
  ["@nemoracode/ai/providers/zai", () => import("@nemoracode/ai/providers/zai")],
  ["@nemoracode/ai/providers/zai/chat", () => import("@nemoracode/ai/providers/zai/chat")],
  ["@nemoracode/ai/providers/zai-coding-plan", () => import("@nemoracode/ai/providers/zai-coding-plan")],
  ["@nemoracode/ai/providers/zai-coding-plan/chat", () => import("@nemoracode/ai/providers/zai-coding-plan/chat")],
  ["@nemoracode/ai/providers/zai-coding-plan/messages", () => import("@nemoracode/ai/providers/zai-coding-plan/messages")],
  [
    "@nemoracode/ai/providers/zai-coding-plan/responses",
    () => import("@nemoracode/ai/providers/zai-coding-plan/responses"),
  ],
])

/** Native `@nemoracode/ai/providers/*` entrypoints bundled with Core and loadable by name from config. */
export const builtinPackages: ReadonlySet<string> = new Set(builtins.keys())

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@nemoracode/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

/** nemoracode settings consumed in Core; native packages never receive them. */
const CORE_KEYS = ["chunkTimeout", "compaction", "encoding", "fetch", "headerTimeout", "timeout", "transport"] as const
const PROVIDER_ONLY_KEYS = ["chunkTimeout", "headerTimeout", "timeout", "transport"] as const

export function nativeSettings(settings: Settings): Settings {
  return Struct.omit(settings, CORE_KEYS)
}

export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, PROVIDER_ONLY_KEYS)
}

const decodeTimeout = Schema.decodeUnknownOption(HttpTimeout)

/** Applied to `headerTimeout` when provider settings leave it unset or invalid. */
export const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Applied to `chunkTimeout` when provider settings leave it unset or invalid. Some providers, such as DeepSeek, have
 * specifically asked clients to allow at least 15 minutes, because their models can stream nothing for minutes while
 * they reason.
 */
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000

/** One timeout setting without a default; invalid values are dropped. */
export function timeout(value: unknown) {
  return Option.getOrUndefined(decodeTimeout(value))
}

/** Request timeouts from provider settings, resolved for every route. `timeout` has no default. */
export function timeouts(settings: Readonly<Record<string, unknown>>) {
  return {
    timeout: timeout(settings.timeout),
    headerTimeout: timeout(settings.headerTimeout) ?? DEFAULT_TIMEOUT_MS,
    chunkTimeout: timeout(settings.chunkTimeout) ?? DEFAULT_CHUNK_TIMEOUT_MS,
  }
}

const decodeEncoding = Schema.decodeUnknownOption(Provider.Encoding)

/** Request body encoding from provider or model settings; invalid values are dropped. */
export function encoding(settings: Readonly<Record<string, unknown>>) {
  return Option.getOrUndefined(decodeEncoding(settings.encoding))
}

export function mergeOverlay(
  base: Readonly<Record<string, unknown>> | undefined,
  overlay: Readonly<Record<string, unknown>> | undefined,
): Record<string, Json> | undefined {
  if (base === undefined) return overlay && decodeJsonRecord({ ...overlay })
  if (overlay === undefined) return decodeJsonRecord({ ...base })
  return decodeJsonRecord(mergeRecord(base, overlay))
}

function mergeRecord(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    new Set([...Object.keys(base), ...Object.keys(overlay)]).values().map((key): [string, unknown] => {
      const left = base[key]
      const right = overlay[key]
      if (right === undefined) return [key, left]
      if (isRecord(left) && isRecord(right)) return [key, mergeRecord(left, right)]
      return [key, right]
    }),
  )
}

export function mergeHeaders(
  base: Readonly<Record<string, string>> | undefined,
  overlay: Readonly<Record<string, string>> | undefined,
) {
  if (base === undefined) return overlay && { ...overlay }
  if (overlay === undefined) return { ...base }
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(overlay)]
      .reduce((result, entry) => {
        result.set(entry[0].toLowerCase(), entry)
        return result
      }, new Map<string, [string, string]>())
      .values(),
  )
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@nemoracode/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export interface Editor {
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: () => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@nemoracode/Provider") {}

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const state = State.create<
      Map<
        ID,
        {
          provider: MutableInfo
          models: ReadonlyMap<Model.ID, Model.Info>
          sourceConnection?: IntegrationConnection.Info
        }
      >,
      Editor
    >({
      name: "provider",
      initial: () => new Map(),
      editor: (records) => {
        const maps = new WeakSet<ReadonlyMap<Model.ID, Model.Info>>()
        const models = new WeakSet<Model.Info>()
        const entry = (id: ID) => {
          const current = records.get(id)
          if (current) return current
          const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
          records.set(id, added)
          maps.add(added.models)
          return added
        }
        const writable = (id: ID) => {
          const record = entry(id)
          if (maps.has(record.models)) return record.models as Map<Model.ID, Model.Info>
          const owned = new Map(record.models)
          record.models = owned
          maps.add(owned)
          return owned
        }
        return {
          list: () => Array.from(records.values()),
          get: (id) => records.get(id),
          add: (definition) => {
            records.set(definition.info.id, {
              provider: structuredClone(definition.info) as MutableInfo,
              models: index(definition.info.id, definition.models),
              sourceConnection: definition.sourceConnection,
            })
          },
          update: (id, update) => {
            const record = entry(id)
            update(record.provider)
            record.provider.id = id
            AISDKNative.rewrite(record.provider, {
              specifier: record.provider.package,
              providerID: id,
              canonical: record.provider.canonical,
            })
          },
          remove: (id) => {
            records.delete(id)
          },
          models: {
            set: (id, values) => {
              entry(id).models = index(id, values)
            },
            update: (providerID, modelID, update) => {
              const record = entry(providerID)
              const target = writable(providerID)
              const current = target.get(modelID)
              const model = // An earlier add/set can publish and freeze an owned model within this fold.
                (
                  current && models.has(current) && !Object.isFrozen(current)
                    ? current
                    : current
                      ? structuredClone(current)
                      : Model.Info.default(providerID, modelID)
                ) as DeepMutable<Model.Info>
              update(model)
              model.id = modelID
              model.providerID = providerID
              AISDKNative.rewrite(model, {
                specifier: model.package ?? record.provider.package,
                providerID,
                canonical: model.canonical ?? record.provider.canonical,
                modelID: model.modelID ?? modelID,
              })
              models.add(model)
              target.set(modelID, model)
            },
            remove: (providerID, modelID) => {
              if (!records.has(providerID)) return
              writable(providerID).delete(modelID)
            },
          },
        }
      },
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached: { records: Snapshot["records"]; value: Snapshot } | undefined
    const snapshot = Effect.fn("Provider.snapshot")(function* () {
      while (true) {
        const revision = integrations.revision()
        const records = state.get()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || records !== state.get()) continue
        const byID = new Map(connections.map((integration) => [integration.id, integration]))
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integration = byID.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id))
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !==
              IntegrationConnection.key(integration?.connections[0])
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        if (
          cached?.records === records &&
          cached.value.available.length === available.length &&
          cached.value.available.every((record, index) => record === available[index])
        )
          return cached.value
        const value = freeze({ records, available, providers: available.map((record) => record.provider) }, true)
        cached = { records, value }
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Provider.get")((id) => Effect.sync(() => freeze(state.get().get(id)?.provider, true))),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().values(), (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackageDefinition
})
