import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Money } from "@opencode/schema/money"
import { AbsolutePath } from "@opencode/schema"
import { Agent } from "@opencode/core/agent"
import type { AgentDomain } from "@opencode/plugin/effect/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { GraphService } from "@opencode/core/graph/service"
import { GraphTools } from "@opencode/core/graph/tools"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Tool } from "@opencode/core/tool"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { executeTool, registerToolPlugin } from "../lib/tool"

const tree = Agent.ID.make("tree")
const treeSub = Agent.ID.make("tree-sub")
const childModel = { id: "child", providerID: "test", variant: "default" } as never
const childText =
  "changed: [math.ts::mul]\ninterfaces: none\ncontract_requests: none\nunresolved: none\nverification: none"
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// The child drain: publish one assistant message with the report text, then idle.
// A session titled to include "fail" fails instead (mirrors tool-subagent.test.ts).
const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const completed = new Set<Session.ID>()
      const complete = Effect.fn("GraphSubagentTest.complete")(function* (sessionID: Session.ID) {
        if (completed.has(sessionID)) return
        if ((yield* store.get(sessionID))?.title?.includes("fail")) {
          yield* new SessionRunnerModel.ModelNotSelectedError({ sessionID })
          return
        }
        completed.add(sessionID)
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: treeSub,
          model: childModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
        yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal: 0, text: childText })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens,
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: (sessionID) => complete(sessionID).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

// Per-location plugin activation: register the graph plugin the way production does.
const graphPluginSupervisor = makeLocationNode({
  name: "test/graph-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const agents = yield* Agent.Service
      yield* registerToolPlugin(
        GraphTools.Plugin,
        {
          // The plugin's agent transform must land in the real Agent.Service state
          // (sessions resolve the tree agents' permissions through it).
          agent: {
            get: () => Effect.die("unused agent.get"),
            list: () => Effect.die("unused agent.list"),
            transform: agents.transform,
            reload: agents.reload,
          } as unknown as AgentDomain,
        },
        (name, callback) => hooks.register("tool", name, callback),
      )
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    GraphService.node,
    FileAccess.node,
    FileMutation.node,
    Permission.node,
    Session.node,
    Job.node,
    SubagentJob.node,
    Tool.node,
    PluginHooks.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
])
const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    PluginSupervisor.node.replace(graphPluginSupervisor),
  ]),
)

const MATH = `export function add(a: number, b: number): number {
  return a + b
}

export function mul(a: number, b: number): number {
  return add(a, b) * a * b
}
`

const withProject = (body: (registry: Tool.Interface, parentID: Session.ID, dir: string) => Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir.path, "math.ts"), MATH))
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({
          title: "graph spawn parent",
          location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
        })
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const registry = yield* Tool.Service
          return yield* body(registry, parent.id, dir.path)
        }).pipe(Effect.provide(locations.get(parent.location)))
      }),
    ),
  )

const call = (registry: Tool.Interface, parentID: Session.ID, name: string, input: unknown) =>
  executeTool(registry, {
    sessionID: parentID,
    agent: tree,
    messageID: SessionMessage.ID.make("msg_graph_subagent_test"),
    call: { type: "tool-call" as const, id: `call_${name}`, name, input },
  })

describe("graph spawn_subtree", () => {
  it.effect("runs the child to its report, releases locks, closes the sub task done", () =>
    withProject((registry, parentID) =>
      Effect.gen(function* () {
        const settled = yield* call(registry, parentID, "spawn_subtree", {
          root_nodes: ["math.ts"],
          behavioral_change: "multiply differently",
        })
        expect(settled.status).toBe("completed")
        expect(settled.content).toEqual([{ type: "text", text: childText }])
      }),
    ))

  it.effect("refuses unknown subtree roots", () =>
    withProject((registry, parentID) =>
      Effect.gen(function* () {
        const settled = yield* call(registry, parentID, "spawn_subtree", {
          root_nodes: ["nope.ts"],
          behavioral_change: "nothing",
        })
        expect(settled.status).toBe("completed")
        expect(settled.content).toEqual([{ type: "text", text: `error: no node "nope.ts"` }])
      }),
    ))
})
