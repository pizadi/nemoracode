export * as ConfigGraph from "./graph.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Graph")({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the per-project code graph, its tree agents and tools (default: true)",
  }),
  languages: Schema.Array(Schema.String).pipe(optional).annotate({
    description:
      'Languages the ingest pass parses with tree-sitter; the rest gets fallback regions (default: ["c", "cpp", "python", "typescript", "rust"])',
  }),
  workingSetTokens: Schema.Int.check(Schema.isGreaterThan(0)).pipe(optional).annotate({
    description: "Working-set token budget per session (default: 32768)",
  }),
  subagentNodes: Schema.Int.check(Schema.isGreaterThan(0)).pipe(optional).annotate({
    description: "Extra graph nodes a subtree subagent may create before it must stop and report (default: 100)",
  }),
}) {}

export const Graph = Schema.Union([Schema.Boolean, Info])
