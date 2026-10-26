export * as GraphService from "./service.js"

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "../config.js"
import { FileSystem } from "../filesystem.js"
import { Location } from "../location.js"
import { GraphIngest, type IngestStats } from "./ingest.js"
import { GraphStore } from "./store.js"
import { WorkingSet, type WsSnapshot } from "./working-set.js"

/** Languages the ingest pass parses with tree-sitter; the rest gets fallback regions. */
export const LANGUAGES: ReadonlyArray<string> = ["c", "cpp", "python", "typescript", "rust"]

/** Default working-set budget, in tokens (bytes/4 estimate). */
const WORKING_SET_TOKENS = 32768

/** Default node budget for subtree subagents (per session, create_node). */
const SUBAGENT_NODES = 100

export interface Interface {
  /** False when config.graph disables the feature: the plugin registers nothing. */
  readonly enabled: boolean
  readonly languages: ReadonlyArray<string>
  readonly subagentNodeBudget: number
  /** The Location's graph store, at `<project>/.opencode/graph.db`. */
  readonly store: GraphStore.Store
  readonly projectRoot: string
  /** Ingests changed sources when the store is stale; memoized for the Location. */
  readonly ready: Effect.Effect<IngestStats | undefined, Error>
  /** The session's working set (created on first use). */
  readonly workingSet: (sessionID: string) => WorkingSet
  /** Read-only working-set snapshot for the session; undefined when the session never opened a node. */
  readonly workingSetSnapshot: (sessionID: string) => WsSnapshot | undefined
  /** Charges one created node against the session's subagent budget. */
  readonly chargeNode: (sessionID: string) => { ok: boolean; used: number }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/core/graph/Service") {}

const layer: Layer.Layer<Service, FileSystem.DirectoryNotFoundError, Location.Service | Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const config = yield* Config.Service
    const projectRoot = location.project.directory

    // Boolean shorthand: false disables, true selects defaults; Info overrides fields.
    const latest = Config.latest(yield* config.entries(), "graph")
    const info = latest === undefined || latest === true ? undefined : latest === false ? undefined : latest
    const enabled = latest !== false && info?.enabled !== false
    const languages = info?.languages ?? LANGUAGES
    const workingSetTokens = info?.workingSetTokens ?? WORKING_SET_TOKENS
    const subagentNodeBudget = info?.subagentNodes ?? SUBAGENT_NODES

    // Mirror FileSystem's boot probe: a missing local directory fails the
    // location boot instead of being healed by creating .opencode inside it.
    // Workspace placements skip the probe (the directory may only exist
    // remotely), so the store below is opened lazily on first use.
    if (!location.workspaceID && !existsSync(projectRoot))
      yield* Effect.fail(new FileSystem.DirectoryNotFoundError({ directory: projectRoot, cause: undefined }))

    const graphDir = join(projectRoot, ".opencode")
    const workSets = new Map<string, WorkingSet>()
    let ingested: IngestStats | undefined
    let flight: Promise<IngestStats> | undefined
    let opened: GraphStore.Store | undefined

    const store = (): GraphStore.Store => {
      if (!opened) {
        mkdirSync(graphDir, { recursive: true })
        // Interrupted subagent tasks cannot resume after a restart — the spawn
        // tool call is gone from the (transcript-less) parent. Mark them abandoned.
        opened = GraphStore.Store.open(join(graphDir, "graph.db"))
        opened.abandonActiveSubTasks()
      }
      return opened
    }

    const ready = Effect.suspend(() => {
      const dbPath = join(graphDir, "graph.db")
      if (ingested && !GraphIngest.storeStale(dbPath, projectRoot)) return Effect.succeed(ingested)
      // Serialize concurrent first-callers on one ingest run; share the result.
      // A settled flight must not swallow a later staleness-triggered re-ingest
      // (the drift-rejection path relies on it), so clear it once done.
      flight ??= GraphIngest.ingest(store(), projectRoot, languages).then((stats) => {
        ingested = stats
        return stats
      })
      return Effect.tap(
        Effect.tryPromise({
          try: () => flight!,
          catch: (error) => new Error(`graph ingest failed: ${error}`),
        }),
        (stats) =>
          Effect.logInfo("graph ingested", {
            files: stats.files,
            fileNodes: stats.fileNodes,
            defNodes: stats.defNodes,
            parseFailed: stats.parseFailed,
          }),
      ).pipe(Effect.tap(() => Effect.sync(() => (flight = undefined))))
    })

    const nodesUsed = new Map<string, number>()

    return Service.of({
      enabled,
      languages,
      subagentNodeBudget,
      get store() {
        return store()
      },
      projectRoot,
      ready,
      workingSet: (sessionID) => {
        const existing = workSets.get(sessionID)
        if (existing) return existing
        const ws = new WorkingSet(workingSetTokens)
        workSets.set(sessionID, ws)
        return ws
      },
      workingSetSnapshot: (sessionID) => workSets.get(sessionID)?.peek(store(), projectRoot),
      chargeNode: (sessionID) => {
        const used = (nodesUsed.get(sessionID) ?? 0) + 1
        if (used > subagentNodeBudget) return { ok: false, used: used - 1 }
        nodesUsed.set(sessionID, used)
        return { ok: true, used }
      },
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, Config.node] })

/** True when a graph store file exists for the location (used by tests and diagnostics). */
export const storeExists = (projectRoot: string): boolean => existsSync(join(projectRoot, ".opencode", "graph.db"))
