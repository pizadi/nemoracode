import { Graph } from "@opencode/schema/graph"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const GraphQuery = Schema.Struct({
  ...LocationQuery.fields,
  session: Schema.optional(Schema.String),
}).annotate({ identifier: "GraphQuery" })

export const GraphGroup = HttpApiGroup.make("server.graph")
  .add(
    HttpApiEndpoint.get("graph.status", "/api/graph", {
      query: LocationQuery,
      success: Location.response(Graph.Info),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "graph.status",
          summary: "Graph status",
          description:
            "Code-graph availability and ingest statistics for the requested location. Runs the first ingest when the store is stale or missing; disabled graphs report enabled=false with no stats.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("graph.tree", "/api/graph/tree", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Graph.NodeRow)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "graph.tree",
          summary: "Graph nodes",
          description:
            "Every graph node in containment order, rooted at the project node. Runs the first ingest when the store is stale or missing; an empty array when the graph is disabled.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("graph.workingSet", "/api/graph/working-set", {
      query: GraphQuery,
      success: Location.response(Schema.NullOr(Graph.WorkingSetSnapshot)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "graph.workingSet",
          summary: "Session working set",
          description:
            "Read-only working-set snapshot for the session: rows with state, token estimate, and takeaway, against the configured cap. Null when the session has not opened any nodes. Peek never demotes entries.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("graph.journal", "/api/graph/journal", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(Graph.TaskLedger)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "graph.journal",
          summary: "Task journal",
          description:
            "The most recent active top-level task with its acceptance criteria, journal, and earlier-era scratchpad entries. Null when no task is active.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "graph" }))
