import { GraphService } from "@nemoracode/core/graph/service"
import type { IngestStats } from "@nemoracode/core/graph/ingest"
import { Graph } from "@nemoracode/schema/graph"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"
import { ServiceUnavailableError } from "@nemoracode/protocol/errors"

const toIngest = (stats: IngestStats) => ({
  files: stats.files,
  fileNodes: stats.fileNodes,
  defNodes: stats.defNodes,
  regionNodes: stats.regionNodes,
  callEdges: stats.callEdges,
  importEdges: stats.importEdges,
  extendsEdges: stats.extendsEdges,
  implementsEdges: stats.implementsEdges,
  parseFailed: stats.parseFailed,
})

const ingest = (graph: GraphService.Interface) =>
  graph.ready.pipe(
    Effect.mapError((error) => new ServiceUnavailableError({ service: "graph", message: error.message })),
  )

const toNodeRow = (node: ReturnType<GraphService.Interface["store"]["getNode"]>) =>
  Graph.NodeRow.make({
    id: node.id,
    kind: node.kind,
    ...(node.parent ? { parent: node.parent } : {}),
    ord: node.ord,
    status: node.status,
    ...(node.anchor
      ? { file: node.anchor.file, startLine: node.anchor.startLine, endLine: node.anchor.endLine }
      : {}),
  })

export const GraphHandler = HttpApiBuilder.group(Api, "server.graph", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("graph.status", () =>
        response(
          Effect.gen(function* () {
            const graph = yield* GraphService.Service
            if (!graph.enabled) return Graph.Info.make({ enabled: false, languages: [] })
            const stats = yield* ingest(graph)
            return Graph.Info.make({ enabled: true, languages: [...graph.languages], ingest: toIngest(stats!) })
          }),
        ),
      )
      .handle("graph.tree", () =>
        response(
          Effect.gen(function* () {
            const graph = yield* GraphService.Service
            if (!graph.enabled) return []
            yield* ingest(graph)
            return graph.store.subtree(".").map(toNodeRow)
          }),
        ),
      )
      .handle("graph.workingSet", (ctx) =>
        response(
          Effect.gen(function* () {
            const graph = yield* GraphService.Service
            if (!graph.enabled || !ctx.query.session) return null
            return graph.workingSetSnapshot(ctx.query.session) ?? null
          }),
        ),
      )
      .handle("graph.journal", () =>
        response(
          Effect.gen(function* () {
            const graph = yield* GraphService.Service
            if (!graph.enabled) return null
            const task = graph.store.getActiveTask()
            if (!task) return null
            let definition: Schema.Json
            try {
              definition = JSON.parse(task.definitionJson) as Schema.Json
            } catch {
              definition = {}
            }
            return Graph.TaskLedger.make({
              id: task.id,
              status: task.status,
              era: task.era,
              definition,
              criteria: graph.store.getCriteria().map((c) => ({
                id: c.id,
                text: c.text,
                coveredBy: [...c.coveredBy],
              })),
              journal: graph.store.getJournal(task.id).map((e) => ({
                seq: e.seq,
                era: e.era,
                text: e.text,
                at: e.at,
              })),
              scratch: graph.store.getScratch(task.id).map((s) => ({
                seq: s.seq,
                era: s.era,
                node: s.node,
                takeaway: s.takeaway,
              })),
            })
          }),
        ),
      )
  }),
)
