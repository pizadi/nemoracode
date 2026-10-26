export * as Graph from "./graph.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"

export const Kind = Schema.Literals([
  "directory",
  "file",
  "module",
  "class",
  "function",
  "method",
  "attribute",
  "config",
  "test",
  "region",
  "external",
]).annotate({ identifier: "Graph.Kind" })
export type Kind = typeof Kind.Type

export const Status = Schema.Literals([
  "skeleton",
  "fresh",
  "stale",
  "needs_review",
  "auto_generated",
  "conflict",
]).annotate({ identifier: "Graph.Status" })
export type Status = typeof Status.Type

export const NodeRow = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  parent: optional(Schema.String),
  ord: NonNegativeInt,
  status: Status,
  file: optional(Schema.String),
  startLine: optional(NonNegativeInt),
  endLine: optional(NonNegativeInt),
}).annotate({ identifier: "Graph.NodeRow" })
export interface NodeRow extends Schema.Schema.Type<typeof NodeRow> {}

export const Ingest = Schema.Struct({
  files: NonNegativeInt,
  fileNodes: NonNegativeInt,
  defNodes: NonNegativeInt,
  regionNodes: NonNegativeInt,
  callEdges: NonNegativeInt,
  importEdges: NonNegativeInt,
  extendsEdges: NonNegativeInt,
  implementsEdges: NonNegativeInt,
  parseFailed: NonNegativeInt,
}).annotate({ identifier: "Graph.Ingest" })
export interface Ingest extends Schema.Schema.Type<typeof Ingest> {}

export const Info = Schema.Struct({
  enabled: Schema.Boolean,
  languages: Schema.Array(Schema.String),
  ingest: optional(Ingest),
}).annotate({ identifier: "Graph.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const WorkingSetRow = Schema.Struct({
  state: Schema.Literals(["pinned", "open", "stub"]),
  id: Schema.String,
  tokens: Schema.String,
  takeaway: Schema.String,
  changed: Schema.Boolean,
}).annotate({ identifier: "Graph.WorkingSetRow" })
export interface WorkingSetRow extends Schema.Schema.Type<typeof WorkingSetRow> {}

export const WorkingSetSnapshot = Schema.Struct({
  rows: Schema.Array(WorkingSetRow),
  totalTokens: NonNegativeInt,
  capTokens: NonNegativeInt,
  overBudget: Schema.Boolean,
}).annotate({ identifier: "Graph.WorkingSetSnapshot" })
export interface WorkingSetSnapshot extends Schema.Schema.Type<typeof WorkingSetSnapshot> {}

export const Criterion = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  coveredBy: Schema.Array(Schema.String),
}).annotate({ identifier: "Graph.Criterion" })
export interface Criterion extends Schema.Schema.Type<typeof Criterion> {}

export const JournalEntry = Schema.Struct({
  seq: NonNegativeInt,
  era: NonNegativeInt,
  text: Schema.String,
  at: NonNegativeInt,
}).annotate({ identifier: "Graph.JournalEntry" })
export interface JournalEntry extends Schema.Schema.Type<typeof JournalEntry> {}

export const ScratchEntry = Schema.Struct({
  seq: NonNegativeInt,
  era: NonNegativeInt,
  node: Schema.String,
  takeaway: Schema.String,
}).annotate({ identifier: "Graph.ScratchEntry" })
export interface ScratchEntry extends Schema.Schema.Type<typeof ScratchEntry> {}

export const TaskLedger = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["active", "done", "abandoned"]),
  era: NonNegativeInt,
  definition: Schema.Json,
  criteria: Schema.Array(Criterion),
  journal: Schema.Array(JournalEntry),
  scratch: Schema.Array(ScratchEntry),
}).annotate({ identifier: "Graph.TaskLedger" })
export interface TaskLedger extends Schema.Schema.Type<typeof TaskLedger> {}
