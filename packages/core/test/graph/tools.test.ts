import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AbsolutePath } from "@nemoracode/schema"
import { Document, Info } from "@nemoracode/schema/config"
import { ConfigGraph } from "@nemoracode/schema/config/graph"
import { Agent } from "@nemoracode/core/agent"
import type { AgentDomain } from "@nemoracode/plugin/effect/agent"
import { AppNodeBuilder } from "@nemoracode/core/effect/app-node-builder"
import { Config } from "@nemoracode/core/config"
import { FileAccess } from "@nemoracode/core/file-access"
import { FileMutation } from "@nemoracode/core/file-mutation"
import { GraphService } from "@nemoracode/core/graph/service"
import { GraphTools } from "@nemoracode/core/graph/tools"
import { Job } from "@nemoracode/core/job"
import { Location } from "@nemoracode/core/location"
import { Permission } from "@nemoracode/core/permission"
import { PluginHooks } from "@nemoracode/core/plugin/hooks"
import { Session } from "@nemoracode/core/session"
import { SessionMessage } from "@nemoracode/core/session/message"
import { SubagentJob } from "@nemoracode/core/session/subagent-job"
import { Tool } from "@nemoracode/core/tool"
import { LayerNode } from "@nemoracode/util/effect/layer-node"
import { makeLocationNode } from "@nemoracode/util/effect/app-node"
import { location } from "../fixture/location"
import { withTempDir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { executeTool, registerToolPlugin, type ToolExecution } from "../lib/tool"

const sessionID = Session.ID.make("ses_graph_tools_test")
const tree = Agent.ID.make("tree")

// The tool handlers never read agent registrations back; a no-op transform
// keeps the plugin effect happy without Agent.Service state.
const agentDomain = {
  get: () => Effect.die("unused agent.get"),
  list: () => Effect.die("unused agent.list"),
  default: () => undefined,
  update: () => {},
  remove: () => {},
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
} as unknown as AgentDomain

const graphToolsNode = makeLocationNode({
  name: "test/graph-tools-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(
        GraphTools.Plugin,
        { agent: agentDomain },
        (name, callback) => hooks.register("tool", name, callback),
      )
    }),
  ),
  deps: [
    Tool.node,
    PluginHooks.node,
    GraphService.node,
    FileAccess.node,
    FileMutation.node,
    Location.node,
    Permission.node,
    Session.node,
    Job.node,
    SubagentJob.node,
  ],
})

const MATH = `export function add(a: number, b: number): number {
  return a + b
}

export function mul(a: number, b: number): number {
  return add(a, b) * a * b
}
`

const MAIN = `import { add, mul } from "./math"

export function run(): number {
  return mul(add(1, 2), 3)
}
`

/** Graph tools' plugin plus its real service deps; location bound to the test tmpdir. */
const graphLayer = (
  activeLocation: Layer.Layer<Location.Service>,
  config: Layer.Layer<Config.Service | Config.Test> = Config.testLayer(),
) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      PluginHooks.node,
      GraphService.node,
      FileAccess.node,
      FileMutation.node,
      Location.node,
      graphToolsNode,
    ]),
    [
      Location.node.replace(activeLocation),
      Config.node.replace(config),
      Permission.node.replace(
        permissionLayer({
          assert: () => Effect.void,
          ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "allow" }),
        }),
      ),
      Session.node.replace(
        Layer.succeed(
          Session.Service,
          // The handlers only need create/remove/interrupt (spawn_subtree, untested here).
          { revert: undefined } as unknown as Session.Interface,
        ),
      ),
      Job.node.replace(Layer.mock(Job.Service, {})),
    ],
  )

const withGraph = (
  body: (registry: Tool.Interface, dir: string) => Effect.Effect<void, unknown>,
  config?: Layer.Layer<Config.Service | Config.Test>,
) =>
  withTempDir((tmp) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "math.ts"), MATH))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "main.ts"), MAIN))
      const activeLocation = Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
      )
      return yield* Effect.gen(function* () {
        const registry = yield* Tool.Service
        return yield* body(registry, tmp.path)
      }).pipe(Effect.provide(graphLayer(activeLocation, config)))
    }),
  )

/** A config document carrying just the graph block. */
const graphConfig = (graph: typeof ConfigGraph.Info.Type) =>
  Config.testLayer([new Document({ type: "document", info: Info.make({ graph }) })])

const call = (registry: Tool.Interface, name: string, input: unknown, agent = tree) =>
  executeTool(registry, {
    sessionID,
    agent,
    messageID: SessionMessage.ID.make("msg_graph_tools_test"),
    call: { type: "tool-call" as const, id: `call_${name}`, name, input },
  })

/** Tool handlers report failures as model-visible "error: ..." text, not raised errors. */
const out = (settled: ToolExecution): string => {
  expect(settled.status).toBe("completed")
  const content = settled.content as unknown
  if (typeof content === "string") return content
  const part = (content as Array<{ text?: string }> | undefined)?.[0]
  return part?.text ?? ""
}

const it = testEffect(Layer.empty)

describe("graph tools", () => {
  it.effect("ingest → search miss on stubs → edit_node fills descriptor → search hits", () =>
    withGraph((registry) =>
      Effect.gen(function* () {
        // Freshly parsed nodes are stubs without descriptors: BM25 has nothing to hit.
        const miss = yield* call(registry, "search_graph", { query: "greeting" })
        expect(out(miss)).toBe(`no matches for "greeting"`)

        // edit_node demands the node be open in the working set first.
        const unopened = yield* call(registry, "edit_node", { id: "main.ts::run", new_body: "x" })
        expect(out(unopened)).toContain('open "main.ts::run" in the working set before editing it')

        const opened = yield* call(registry, "open_node", { id: "main.ts::run" })
        expect(out(opened)).toContain("tok") // one-line ack; the body never enters the result

        const edited = yield* call(registry, "edit_node", {
          id: "main.ts::run",
          new_body: `export function run(): number {\n  console.log("greeting")\n  return mul(add(1, 2), 3)\n}`,
          descriptor_update: {
            summary: "logs a greeting then returns (1+2)*3",
            purpose: "entry demo function",
            inputs: [],
            outputs: ["number"],
            side_effects: [],
            invariants: [],
            uses: ["math.ts::mul", "math.ts::add"],
          },
        })
        expect(out(edited)).toContain("edited main.ts::run")
        expect(out(edited)).toContain('+   console.log("greeting")')

        // Re-parse picked up the new body and its descriptor is searchable.
        const hit = yield* call(registry, "search_graph", { query: "greeting" })
        expect(out(hit)).toContain("main.ts::run")

        const closed = yield* call(registry, "close_node", {
          id: "main.ts::run",
          takeaway: "greeting is printed before the math",
        })
        expect(out(closed)).toContain("closed")
      }),
    ))

  it.effect("hand edit outside the anchor rejects the splice and re-ingests", () =>
    withGraph((registry, dir) =>
      Effect.gen(function* () {
        const opened = yield* call(registry, "open_node", { id: "math.ts::mul" })
        expect(out(opened)).toContain("opened")

        // EOF append shifts no anchor byte; only the whole-file hash catches it.
        yield* Effect.promise(() => fs.appendFile(path.join(dir, "math.ts"), "\n// human append\n"))
        const rejected = yield* call(registry, "edit_node", {
          id: "math.ts::mul",
          new_body: `export function mul(a: number, b: number): number {\n  return add(a, b) * a\n}`,
        })
        expect(out(rejected)).toContain("human edit outside the anchor")
        // The rejected splice did not corrupt the file.
        const after = yield* Effect.promise(() => fs.readFile(path.join(dir, "math.ts"), "utf8"))
        expect(after).toContain("human append")

        // Graph refreshed: re-open sees the fresh hash and the same edit goes through.
        expect(out(yield* call(registry, "open_node", { id: "math.ts::mul" }))).toContain("opened")
        const ok = yield* call(registry, "edit_node", {
          id: "math.ts::mul",
          new_body: `export function mul(a: number, b: number): number {\n  return add(a, b) * a\n}`,
          descriptor_update: {
            summary: "multiply via add",
            purpose: "demo",
            inputs: [],
            outputs: ["number"],
            side_effects: [],
            invariants: [],
            uses: ["math.ts::add"],
          },
        })
        expect(out(ok)).toContain("edited math.ts::mul")
      }),
    ))

  it.effect("signature change is rejected and rolled back", () =>
    withGraph((registry, dir) =>
      Effect.gen(function* () {
        expect(out(yield* call(registry, "open_node", { id: "math.ts::add" }))).toContain("opened")
        const rejected = yield* call(registry, "edit_node", {
          id: "math.ts::add",
          new_body: `export function add(a: number, b: string): number {\n  return a + Number(b)\n}`,
        })
        expect(out(rejected)).toContain("signature changed (contract change)")
        expect(out(rejected)).toContain("(file restored, graph re-ingested)")
        const after = yield* Effect.promise(() => fs.readFile(path.join(dir, "math.ts"), "utf8"))
        expect(after).toContain("b: number")
      }),
    ))

  it.effect("file tools are blocked for tree agents — edit_node is the only write", () =>
    withGraph((registry) =>
      Effect.gen(function* () {
        const settled = yield* call(registry, "edit", {
          filePath: "math.ts",
          oldString: "a",
          newString: "b",
        })
        expect(settled.status).toBe("error")
        expect(JSON.stringify(settled.error)).toContain("edit_node is the only way to modify code")
      }),
    ))

  it.effect("skeleton stage forbids body edits; validate_skeleton reports and gates the stage", () =>
    withGraph((registry) =>
      Effect.gen(function* () {
        expect(out(yield* call(registry, "set_stage", { stage: "skeleton" }))).toContain("stage: skeleton")
        expect(out(yield* call(registry, "open_node", { id: "math.ts::add" }))).toContain("opened")
        const refused = yield* call(registry, "edit_node", {
          id: "math.ts::add",
          new_body: `export function add(a: number, b: number): number {\n  return a + b + 1\n}`,
        })
        expect(out(refused)).toContain("forbids body edits")

        const report = out(yield* call(registry, "validate_skeleton", {}))
        // The stub graph passes structural validation (deps resolve, no cycles,
        // no criteria), so the stage advances out of skeleton.
        expect(report).toContain("stage advanced to validate")

        // slice restricts body edits to the slice roots.
        expect(out(yield* call(registry, "set_stage", { stage: "slice", slice_roots: ["main.ts::run"] }))).toContain(
          "stage: slice",
        )
        expect(out(yield* call(registry, "open_node", { id: "math.ts::mul" }))).toContain("opened")
        const outside = yield* call(registry, "edit_node", {
          id: "math.ts::mul",
          new_body: `export function mul(a: number, b: number): number {\n  return add(a, b) * a\n}`,
        })
        expect(out(outside)).toContain("only allows body edits within the slice roots")
      }),
    ))

  it.effect("config.graph tunes the working-set budget and the subagent node budget", () =>
    withGraph(
      (registry) =>
        Effect.gen(function* () {
          expect(out(yield* call(registry, "open_node", { id: "main.ts::run" }))).toContain("/100")

          const created = yield* call(
            registry,
            "create_node",
            { parent: ".", name: "a.ts", kind: "file" },
            Agent.ID.make("tree-sub"),
          )
          expect(out(created)).toContain("created a.ts")
          const exhausted = yield* call(
            registry,
            "create_node",
            { parent: ".", name: "b.ts", kind: "file" },
            Agent.ID.make("tree-sub"),
          )
          expect(out(exhausted)).toContain("node budget exhausted (1/1 nodes)")
        }),
      graphConfig({ workingSetTokens: 100, subagentNodes: 1 }),
    ))

  it.effect("config.graph.enabled=false removes the graph tools", () =>
    withGraph(
      (registry) =>
        Effect.gen(function* () {
          const settled = yield* call(registry, "search_graph", { query: "x" })
          expect(settled.status).toBe("error")
          expect(JSON.stringify(settled.error)).toContain("No tool named \\\"search_graph\\\" is currently available")
        }),
      graphConfig({ enabled: false }),
    ))
})
