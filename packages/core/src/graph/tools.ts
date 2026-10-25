export * as GraphTools from "./tools.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Message, ToolFailure } from "@opencode/ai/effect"
import { Effect, Result, Schema } from "effect"
import { mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Agent } from "../agent.js"
import { FileMutation } from "../file-mutation.js"
import { FileAccess } from "../file-access.js"
import { Job } from "../job.js"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { SessionMessage } from "../session/message.js"
import { SessionSchema } from "../session/schema.js"
import { SubagentJob } from "../session/subagent-job.js"
import { Tool } from "../tool.js"
import { GraphDescriptor } from "./descriptor.js"
import { GraphHash } from "./hash.js"
import { languageForFile } from "./ingest.js"
import { TaskState } from "./l2.js"
import { GraphStore, type EdgeType, type Node } from "./store.js"
import { GraphService } from "./service.js"
import { GraphValidate } from "./validate.js"
import { nodeBody, summaryOf } from "./working-set.js"

const INSPECT_BODY_CAP = 16 * 1024

const tree = Agent.ID.make("tree")
const treeSub = Agent.ID.make("tree-sub")
const isTreeAgent = (agent: Agent.ID) => agent === tree || agent === treeSub

/** The slice of tool Context the graph tools need. */
interface ToolCtx {
  readonly sessionID: SessionSchema.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly id: Tool.CallID
  readonly progress: (update: Record<string, unknown>) => Effect.Effect<void>
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Runs a sync store/file operation; GraphError becomes a model-visible "error: ..." failure. */
const storeOp = <A>(op: () => A): Effect.Effect<A, ToolFailure> =>
  Effect.try({
    try: op,
    catch: (error) =>
      new ToolFailure({
        message: error instanceof GraphStore.GraphError ? `error: ${error.message}` : `error: ${error}`,
      }),
  })

const text = (content: string) => Effect.succeed({ content })

const anchorText = (node: Node): string =>
  node.anchor ? `${node.anchor.file} L${node.anchor.startLine}-L${node.anchor.endLine}` : "skeleton — no body yet"

const joinList = (values: ReadonlyArray<string>): string => values.join(", ")

// --- stage helpers (stage_tools.cpp) ------------------------------------------------

const STAGE_NAMES = ["none", "skeleton", "validate", "slice", "fill"] as const
export type Stage = (typeof STAGE_NAMES)[number]

const parseStage = (value: string): Stage | undefined => STAGE_NAMES.find((stage) => stage === value)

export const getStage = (store: GraphStore.Store): Stage => {
  const value = store.getMeta("stage")
  return (value && parseStage(value)) || "none"
}

const getSliceRoots = (store: GraphStore.Store): Array<string> => {
  const value = store.getMeta("slice_roots")
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

const underRoot = (store: GraphStore.Store, id: string, root: string): boolean => {
  if (id === root) return true
  return store.ancestors(id).some((ancestor) => ancestor.id === root)
}

const stageGateBodyEdit = (store: GraphStore.Store, id: string): string => {
  const stage = getStage(store)
  if (stage === "none" || stage === "fill") return ""
  if (stage === "slice") {
    const roots = getSliceRoots(store)
    for (const root of roots) if (underRoot(store, id, root)) return ""
    return `error: stage 'slice' only allows body edits within the slice roots (${joinList(roots)}) — advance to fill first`
  }
  return `error: stage '${stage}' forbids body edits — the skeleton must pass validate_skeleton first (descriptor_update is still allowed)`
}

// --- edit_node helpers (edit_node.cpp) -------------------------------------------------

// Signature headers of every contract-bearing node in the subtree, from the live bodies.
const subtreeHeaders = (store: GraphStore.Store, root: string, projectRoot: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const node of store.subtree(root)) {
    if (!node.anchor || !GraphDescriptor.contractBearingKind(node.kind)) continue
    const body = nodeBody(node, projectRoot)
    if (body === undefined) continue
    out.set(node.id, GraphDescriptor.signatureHeader(body, languageForFile(node.anchor.file)))
  }
  return out
}

const usesViolations = (store: GraphStore.Store, id: string, descriptor: Record<string, unknown>): string => {
  const declared = new Set<string>()
  if (Array.isArray(descriptor["uses"]))
    for (const use of descriptor["uses"]) if (typeof use === "string") declared.add(use)
  const own = new Set<string>(store.subtree(id).map((node) => node.id))

  const bad: Array<string> = []
  for (const edge of store.edgesFrom(id, ["calls", "extends", "implements"])) {
    if (edge.source !== "parsed") continue
    if (edge.confidence < 0.999) continue // ambiguous overloads warn, not block
    if (!declared.has(edge.dst) && !own.has(edge.dst)) bad.push(edge.dst)
  }
  if (bad.length === 0) return ""
  return `undeclared dependencies (declare them in descriptor.uses): ${joinList(bad)}`
}

// Small LCS line diff (capped output). Good enough for tool feedback.
const splitLines = (value: string): Array<string> =>
  value.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))

const lineDiff = (oldBody: string, newBody: string): string => {
  const a = splitLines(oldBody)
  const b = splitLines(newBody)
  const dp: Array<Array<number>> = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out: Array<string> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`- ${a[i++]}`)
    } else {
      out.push(`+ ${b[j++]}`)
    }
  }
  while (i < a.length) out.push(`- ${a[i++]}`)
  while (j < b.length) out.push(`+ ${b[j++]}`)

  const cap = 60
  if (out.length <= cap) return out.map((line) => `${line}\n`).join("")
  let value = ""
  for (const line of out.slice(0, cap / 2)) value += `${line}\n`
  value += `[… ${out.length - cap} more diff lines …]\n`
  for (const line of out.slice(out.length - cap / 2)) value += `${line}\n`
  return value
}

// --- schemas ---------------------------------------------------------------------

const idField = Schema.String.annotate({ description: "node id" })

const InputSearchGraph = Schema.Struct({
  query: Schema.String.annotate({ description: "space-separated search words" }),
  limit: Schema.optionalKey(Schema.Int).annotate({ description: "max results (default 20, max 50)" }),
})

const InputInspect = Schema.Struct({
  id: idField,
  tier: Schema.optionalKey(Schema.Literals(["stub", "contract", "body"])).annotate({
    description: "stub | contract | body (default body)",
  }),
})

const InputNeighbors = Schema.Struct({
  id: idField,
  edge_types: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: 'filter, e.g. ["calls"] (default: all types)',
  }),
  depth: Schema.optionalKey(Schema.Int).annotate({ description: "1-3 (default 1)" }),
  token_budget: Schema.optionalKey(Schema.Int).annotate({
    description: "approx output token cap (default 2000)",
  }),
})

const InputId = Schema.Struct({ id: idField })

const InputCloseNode = Schema.Struct({
  id: idField,
  takeaway: Schema.String.annotate({ description: "one line: what you learned from this body" }),
})

const InputCreateNode = Schema.Struct({
  parent: Schema.String.annotate({ description: 'parent node id (file or symbol). Use "." for the root' }),
  name: Schema.String.annotate({ description: 'leaf name, e.g. "parse_header"' }),
  kind: Schema.String.annotate({
    description:
      "directory | file | module | class | function | method | attribute | config | test | region | external",
  }),
  descriptor: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "contract JSON object",
  }),
  body: Schema.optionalKey(Schema.String).annotate({
    description: "initial source text appended to the parent's file (signature + stub body in the target language)",
  }),
})

const InputEditNode = Schema.Struct({
  id: idField,
  new_body: Schema.optionalKey(Schema.String).annotate({
    description: "replacement body (whole file for a skeleton file; signature + stub for a skeleton definition)",
  }),
  descriptor_update: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "keys merged onto the node's descriptor contract",
  }),
  edge_updates: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        op: Schema.Literals(["add", "remove"]),
        type: Schema.String.annotate({ description: "edge type; not uses — that is descriptor.uses" }),
        dst: Schema.String,
      }),
    ),
  ).annotate({ description: "declared edge changes" }),
})

const InputDefineTask = Schema.Struct({
  goal: Schema.String.annotate({ description: "what to achieve, a few sentences" }),
  root_nodes: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "node ids of the subtree this task owns",
  }),
  behavioral_change: Schema.optionalKey(Schema.String).annotate({ description: "required behavior change" }),
  constraints: Schema.optionalKey(Schema.String).annotate({ description: "frozen interfaces, limits" }),
  return_format: Schema.optionalKey(Schema.String).annotate({ description: "required shape of the final report" }),
})

const InputJournalAppend = Schema.Struct({
  entry: Schema.String.annotate({ description: "one progress entry: decision, change, step or blocker" }),
})

const InputFinishTask = Schema.Struct({
  status: Schema.Literals(["done", "abandoned"]),
  result: Schema.optionalKey(Schema.String).annotate({ description: "final report (any JSON; free text is fine)" }),
})

const InputSetAcceptance = Schema.Struct({
  criteria: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      covered_by: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "node ids" }),
    }),
  ).annotate({ description: "list of {id, text, covered_by}" }),
})

const InputValidateSkeleton = Schema.Struct({
  root: Schema.optionalKey(idField).annotate({ description: "validate only this node's subtree (default: whole graph)" }),
})

const InputSetStage = Schema.Struct({
  stage: Schema.String.annotate({ description: "none | skeleton | validate | slice | fill" }),
  slice_roots: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "node ids of the vertical slice (required for slice)",
  }),
})

const InputSpawnSubtree = Schema.Struct({
  root_nodes: Schema.Array(Schema.String).annotate({ description: "node ids of the subtree roots to lock" }),
  behavioral_change: Schema.String.annotate({ description: "what must change, stated as behavior" }),
  instructions: Schema.optionalKey(Schema.String).annotate({
    description: "extra instructions beyond behavioral_change (constraints, pointers)",
  }),
})

// --- the plugin ----------------------------------------------------------------------

export const Plugin = {
  id: "opencode.graph",
  effect: Effect.fn("GraphPlugin.Plugin")(function* (ctx: Context) {
    const graph = yield* GraphService.Service
    if (!graph.enabled) return
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const subagents = yield* SubagentJob.Service

    // The sub task record per running subagent session, so journal_append lands in the sub task.
    const subTasks = new Map<string, GraphStore.TaskRecord>()

    const TREE_SYSTEM = [
      `You are tree, a terse coding agent working inside this project's root directory.`,
      "",
      "Code graph: the project is ingested into a code graph (nodes for files and definitions, typed",
      "edges between them). search_graph finds nodes by their descriptors, inspect reads a node (tiers:",
      "stub/contract/body), neighbors walks its edges. Prefer inspect stubs over reading whole files.",
      "",
      "Writing code: edit_node(id, new_body, descriptor_update, edge_updates) is the ONLY way to modify",
      "code — edit/write/patch are blocked. Open the node first (open_node); its body is replaced by",
      "byte range and the graph re-parses. Signatures and inputs/outputs in the edited subtree are",
      "frozen — contract changes are rejected. Declare every new dependency in descriptor.uses. A",
      "skeleton file takes the whole file text as new_body; a skeleton definition takes signature +",
      "stub body (pass, {}, todo!()); filling an anchored stub is an ordinary body edit. The result is",
      "a small diff — re-open to see the new body.",
      "",
      "Working set: open_node(id) loads a node's body into the working set, a block rendered at the end",
      "of every turn; close_node(id, takeaway) demotes it to a stub and requires a one-line takeaway;",
      "pin_node(id) protects a chunk from auto-demotion when the set overflows. Bodies in the working",
      "set never enter the transcript — only your tool calls do.",
      "",
      "Workflow stages: set_stage controls how much structure is enforced. \"skeleton\" is the design",
      "phase — create skeleton nodes with complete descriptors and dependencies declared in",
      "descriptor.uses; body edits on existing code are refused. validate_skeleton runs the structural",
      "checks (dependencies resolve, descriptor fields, cycles, acceptance coverage) and a passing",
      "report advances the stage to validate. set_stage \"slice\" re-validates and marks the thin",
      "end-to-end path (slice_roots); while slicing, body edits are restricted to the slice roots.",
      "set_stage \"fill\" requires every slice node materialized and fresh, then body edits are",
      "unrestricted. set_acceptance records the criteria validate_skeleton checks. \"none\" disables",
      "gating for small fixes.",
      "",
      "Tasks and journal: for multi-step work, define_task(goal, …) declares the task (goal required;",
      "root_nodes, constraints, return_format optional); journal_append(entry) records decisions,",
      "interface changes, completed sub-steps and blockers as they happen; finish_task(status, result)",
      "closes it. The task definition, journal and scratchpad render ahead of the transcript and",
      "survive context rotation — treat the journal as notes to your future self. When the transcript",
      "nears the limit the harness rotates it and expects the journal to be current. close_node",
      "takeaways are saved to the task scratchpad.",
      "",
      "Delegation: for a self-contained change on one subtree, spawn_subtree(root_nodes,",
      "behavioral_change) runs a subagent that owns the subtree and returns a short report; you never",
      "see its code or transcript.",
    ].join("\n")

    const TREE_SUB_SYSTEM = [
      "You are a tree subagent working inside this project. Your task definition (goal, roots, return",
      "format) and dependency contracts render ahead of the transcript.",
      "Scope: you own the locked subtree — edit_node/create_node writes are refused outside it. You may",
      "read anything (inspect, neighbors, search_graph) and use read-only shell commands.",
      "Keep the working set tight (open_node/close_node with takeaways).",
      "journal_append(entry) records your progress — your task's journal feeds context rotation.",
      "validate_skeleton runs structural checks as a dry run; stage transitions belong to the parent",
      "agent.",
      "When done, reply with ONLY the final report in exactly this format — all five sections, in",
      "order:",
      "changed: [node ids]",
      "interfaces: [signature changes, new public nodes]",
      "contract_requests: [any approved/pending requests]",
      "unresolved: [open questions, known gaps]",
      "verification: [what ran, result]",
    ].join("\n")

    yield* ctx.agent.transform((editor) => {
      editor.update(tree, (item) => {
        item.name = Agent.Name.make("Tree")
        item.description = "Graph-addressed coding agent: works on a code graph with a bounded working set."
        item.mode = "primary"
        item.system = TREE_SYSTEM
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })
      editor.update(treeSub, (item) => {
        item.name = Agent.Name.make("Tree Sub")
        item.description = "Subagent that owns one locked subtree and reports back to its parent."
        item.mode = "subagent"
        item.system = TREE_SUB_SYSTEM
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })
    })

    // edit_node is the only code write for tree agents: block the file tools.
    yield* ctx.tool.hook("execute.before", (event) => {
      if (!isTreeAgent(event.agent)) return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      return Effect.fail(
        new ToolFailure({
          message: `error: ${event.tool} is disabled for this agent — edit_node is the only way to modify code (open_node the node, then edit_node)`,
        }),
      )
    })

    // L2 (task state) renders before the transcript, L3 (working set + stage)
    // after it — both re-rendered per request, never persisted.
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (!isTreeAgent(event.agent)) return
        const sub = subTasks.get(event.sessionID)
        const l2 = TaskState.renderL2(graph.store, sub?.id)
        if (l2)
          event.messages.unshift(
            Message.user(`[task state — rendered, not part of the transcript]\n\n${l2}`),
          )
        const snapshot = graph.workingSet(event.sessionID).render(graph.store, graph.projectRoot)
        const l3 = `stage: ${getStage(graph.store)}\n\n${snapshot.text}`
        event.messages.push(Message.user(`[working set — rendered state, not part of the transcript]\n\n${l3}`))
      }),
    )

    // Journal-driven rotation: when an active task has a journal, compaction
    // becomes a deterministic rotation (task state carries the context; the
    // transcript is dropped). Without a journal, normal LLM compaction runs.
    yield* ctx.session.hook("compaction", (event) =>
      Effect.sync(() => {
        if (!isTreeAgent(event.agent)) return
        const task = graph.store.getActiveTask()
        if (!task) return
        if (graph.store.getJournal(task.id).length === 0) return
        graph.store.bumpEra(task.id)
        graph.workingSet(event.sessionID).resetForRotation()
        event.result = {
          summary: [
            "[harness: context rotated — the transcript before this message was dropped. The task",
            "definition, journal and scratchpad follow; continue from the journal.]",
            "",
            TaskState.renderL2(graph.store, task.id),
            "## Verification status",
            "The transcript was rotated before this point. Re-check the working tree (git diff, tests)",
            "if the journal does not state the current verification status.",
          ].join("\n"),
        }
      }),
    )

    /** Permission gate for file writes, mirroring the write tool's leaf. */
    const authorizeWrite = (context: ToolCtx, resource: string, metadata: Record<string, unknown>) =>
      permission
        .assert({
          action: "edit",
          resources: [resource],
          save: ["*"],
          metadata,
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool" as const, messageID: context.messageID, id: context.id },
        })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: "error: write denied", error })))

    // --- create_node body (shared by create_node's optional body and edit_node) ------

    /** Appends `body` to `file` (pad \n) and returns the [start, end) byte anchors + lines. */
    const appendToFile = (file: string, body: string, context: ToolCtx, node: string) =>
      Effect.gen(function* () {
        const target = yield* access
          .resolve({ path: file, kind: "file" })
          .pipe(Effect.mapError((error) => new ToolFailure({ message: `error: cannot resolve ${file}`, error })))
        yield* authorizeWrite(context, target.resource, { graph: "create_node", node })
        const existing = readFileSync(join(graph.projectRoot, file), "utf8")
        const pad = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
        yield* fileMutation.writeTextPreservingBom({ target, content: `${existing}${pad}${body}` }).pipe(
          Effect.mapError((error) => new ToolFailure({ message: `error: write to ${file} failed`, error })),
        )
        const startByte = existing.length + pad.length
        const startLine = 1 + (existing.match(/\n/g)?.length ?? 0) + (pad ? 1 : 0)
        const endLine =
          startLine + (body.match(/\n/g)?.length ?? 0) - (body.endsWith("\n") ? 1 : 0)
        return { startByte, endByte: startByte + body.length, startLine, endLine }
      })

    // --- edit_node -----------------------------------------------------------------

    const editNode = (
      input: {
        id: string
        new_body?: string
        descriptor_update?: Record<string, unknown>
        edge_updates?: Array<{ op: "add" | "remove"; type: string; dst: string }>
      },
      context: ToolCtx,
    ): Effect.Effect<{ content: string }, ToolFailure> =>
      Effect.gen(function* () {
        const store = graph.store
        const hasBody = input.new_body !== undefined && input.new_body.length > 0
        const hasDesc = input.descriptor_update !== undefined
        const hasEdges = input.edge_updates !== undefined
        if (!hasBody && !hasDesc && !hasEdges)
          return yield* text("error: nothing to do — pass new_body, descriptor_update or edge_updates")

        let node: Node
        try {
          node = store.getNode(input.id)
        } catch {
          return yield* text(`error: no node "${input.id}"`)
        }

        // 1. Lock.
        const holder = store.lockHolder(input.id)
        if (holder && holder !== context.sessionID)
          return yield* text(`error: node "${input.id}" is locked by ${holder}`)

        // Descriptor merge (before anything touches disk).
        let merged: Record<string, unknown> | undefined
        if (hasDesc) {
          let base: Record<string, unknown> = {}
          if (node.descriptorJson) {
            try {
              const parsed: unknown = JSON.parse(node.descriptorJson)
              if (isJsonObject(parsed)) base = parsed
            } catch {
              base = {}
            }
          }
          merged = { ...base, ...input.descriptor_update }
          const complete = GraphDescriptor.descriptorComplete(JSON.stringify(merged))
          if (!complete.ok)
            return yield* text(`error: descriptor incomplete after update — missing/empty fields: ${complete.missing}`)
        }

        // --- skeleton file: write the whole file, re-ingest, node materializes ----
        if (!node.anchor && node.kind === "file") {
          if (!hasBody) return yield* text("error: a skeleton file needs new_body (the file text)")
          const rel = input.id
          if (rel === "." || rel.startsWith("/") || rel.includes("..") || rel.endsWith("/"))
            return yield* text(`error: invalid file path "${rel}"`)
          if (existsSync(join(graph.projectRoot, rel)))
            return yield* text(`error: file "${rel}" already exists on disk`)
          const target = yield* access
            .resolve({ path: rel, kind: "file" })
            .pipe(Effect.mapError((error) => new ToolFailure({ message: `error: cannot resolve ${rel}`, error })))
          yield* authorizeWrite(context, target.resource, { graph: "edit_node", node: input.id })
          yield* fileMutation
            .writeTextPreservingBom({ target, content: input.new_body! })
            .pipe(Effect.mapError((error) => new ToolFailure({ message: `error: write to ${rel} failed`, error })))
          yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
          let materialized: Node | undefined
          try {
            materialized = store.getNode(input.id)
          } catch {
            return yield* text(`error: file written but no node "${input.id}" appeared after re-ingest`)
          }
          void materialized
          if (hasDesc) yield* storeOp(() => store.setDescriptor(input.id, JSON.stringify(merged)))
          return yield* text(`created ${input.id} from skeleton (${rel}, ${input.new_body!.length} bytes)`)
        }

        // --- directory nodes: no anchor, no body; contract updates only ----------
        if (node.kind === "directory") {
          if (hasBody) return yield* text("error: directory nodes have no body — edit the files inside them")
          if (hasDesc) yield* storeOp(() => store.setDescriptor(input.id, JSON.stringify(merged)))
          return yield* text(`ok: directory "${input.id}" descriptor updated`)
        }

        // --- skeleton def: append the stub to the parent file, re-ingest ----------
        if (!node.anchor) {
          if (!hasBody)
            return yield* text(`error: skeleton "${input.id}" has no body; pass new_body (signature + stub body)`)
          if (!node.parent) return yield* text(`error: skeleton "${input.id}" has no parent to write into`)
          let parent: Node
          try {
            parent = store.getNode(node.parent)
          } catch {
            return yield* text("error: parent node vanished")
          }
          if (!parent.anchor)
            return yield* text(
              `error: parent "${node.parent}" has no anchor; materialize the parent (or a skeleton file) first`,
            )
          const file = parent.anchor.file
          const anchor = yield* appendToFile(file, input.new_body!, context, input.id)
          yield* storeOp(() => store.setAnchor(input.id, { file, ...anchor }, GraphHash.hashText(input.new_body!)))
          yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
          let after: Node
          try {
            after = store.getNode(input.id)
          } catch {
            return yield* text(
              `error: node "${input.id}" vanished after re-ingest (name/shape mismatch) — inspect the file node and re-create the skeleton with the right name`,
            )
          }
          if (!after.anchor)
            return yield* text(
              `warning: appended ${file} but no parsed node matched "${input.id}" — skeleton kept; inspect the file node and re-create the skeleton with the right name`,
            )
          if (hasDesc) yield* storeOp(() => store.setDescriptor(input.id, JSON.stringify(merged)))
          return yield* text(
            `materialized ${input.id} in ${file} L${after.anchor.startLine}-L${after.anchor.endLine}`,
          )
        }

        // --- anchored node: drift check, splice, re-ingest, verify ----------------
        if (hasBody) {
          const gate = stageGateBodyEdit(store, input.id)
          if (gate) return yield* text(gate)
        }

        const file = node.anchor.file
        const bytes = yield* Effect.try({
          try: () => readFileSync(join(graph.projectRoot, file), "utf8"),
          catch: () => new ToolFailure({ message: `error: source file ${file} missing` }),
        })

        // Whole-file freshness: the anchor-range check below is blind to edits
        // that land OUTSIDE this node's anchor — a hand-appended line at EOF
        // shifts no anchor byte and would be silently clobbered by the splice.
        // The containing file node's content_hash covers the entire file.
        const fileId = node.kind === "file" ? node.id : store.ancestors(input.id).find((a) => a.kind === "file")?.id
        if (fileId) {
          const fileNode = store.getNode(fileId)
          if (fileNode.contentHash && GraphHash.hashText(bytes) !== fileNode.contentHash) {
            yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
            return yield* text(
              `error: file changed on disk since the graph last saw it: "${file}" (human edit outside the anchor) — graph refreshed, re-open the node and redo`,
            )
          }
        }

        const liveStart = Math.min(node.anchor.startByte, bytes.length)
        const liveEnd = Math.min(node.anchor.endByte, bytes.length)
        const live = bytes.slice(liveStart, liveEnd)
        if (GraphHash.hashText(live) !== (node.contentHash ?? "")) {
          yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
          return yield* text(
            `error: file changed on disk since the graph last saw "${input.id}" (human edit) — graph refreshed, re-open the node and redo`,
          )
        }
        const seen = graph.workingSet(context.sessionID).seenHash(input.id)
        if (!seen || seen !== (node.contentHash ?? ""))
          return yield* text(`error: open "${input.id}" in the working set before editing it`)

        // Contract freeze: inputs/outputs of an anchored node are its boundary.
        if (hasDesc && node.descriptorJson) {
          try {
            const oldDescriptor = JSON.parse(node.descriptorJson) as Record<string, unknown>
            for (const key of ["inputs", "outputs"]) {
              const before = JSON.stringify(oldDescriptor[key])
              const after = JSON.stringify(merged![key])
              if (before !== undefined && after !== undefined && before !== after)
                return yield* text(`error: ${key} are frozen (contract change) — pass them unchanged, or request a contract change from the parent agent`)
            }
          } catch {
            // unreadable old descriptor: the completeness check already gated it
          }
        }

        // Pre-edit state for the own-write refresh + rollback.
        const preSeen = graph.workingSet(context.sessionID).seenHashes()
        const preStore = new Map<string, string>()
        for (const entryId of preSeen.keys()) {
          try {
            preStore.set(entryId, store.getNode(entryId).contentHash ?? "")
          } catch {
            // gone: skip
          }
        }
        const preHeaders = subtreeHeaders(store, input.id, graph.projectRoot)
        const oldBody = live
        const newBody = hasBody ? input.new_body! : oldBody
        let rolledBack = false

        const rollback = (message: string): Effect.Effect<{ content: string }, ToolFailure> =>
          Effect.gen(function* () {
            if (hasBody && !rolledBack) {
              rolledBack = true
              const target = yield* access
                .resolve({ path: file, kind: "file" })
                .pipe(Effect.orElseSucceed(() => undefined))
              if (target) yield* fileMutation.writeTextPreservingBom({ target, content: bytes }).pipe(Effect.orElseSucceed(() => undefined))
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              return yield* text(`error: ${message} (file restored, graph re-ingested)`)
            }
            return yield* text(`error: ${message}`)
          })

        if (hasBody) {
          const target = yield* access
            .resolve({ path: file, kind: "file" })
            .pipe(Effect.mapError((error) => new ToolFailure({ message: `error: cannot resolve ${file}`, error })))
          yield* authorizeWrite(context, target.resource, { graph: "edit_node", node: input.id })
          yield* fileMutation
            .writeTextPreservingBom({
              target,
              content: bytes.slice(0, node.anchor.startByte) + newBody + bytes.slice(node.anchor.endByte),
            })
            .pipe(Effect.mapError((error) => new ToolFailure({ message: `error: write to ${file} failed`, error })))
          yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
        }

        // Contract boundary: the whole edited subtree must keep its signatures.
        const problems: Array<string> = []
        for (const [nodeId, header] of preHeaders) {
          let after: Node
          try {
            after = store.getNode(nodeId)
          } catch {
            problems.push(`${nodeId} was removed or renamed (contract change)`)
            continue
          }
          if (!after.anchor) continue
          const afterBody = nodeBody(after, graph.projectRoot) ?? ""
          const afterHeader = GraphDescriptor.signatureHeader(afterBody, languageForFile(after.anchor.file))
          if (afterHeader !== header) problems.push(`${nodeId} signature changed (contract change)`)
        }
        if (problems.length > 0) return yield* rollback(joinList(problems))

        // Dependency declaration: after a body edit, confident parsed edges from
        // the node must be declared (effective uses = merged or existing).
        const warnings: Array<string> = []
        const effective = merged ?? (() => {
          try {
            const parsed: unknown = JSON.parse(node.descriptorJson ?? "{}")
            return isJsonObject(parsed) ? parsed : {}
          } catch {
            return {}
          }
        })()
        if (hasBody) {
          const violation = usesViolations(store, input.id, effective)
          if (violation) return yield* rollback(violation)
          if (!hasDesc)
            warnings.push("descriptor not updated — node is now stale; pass descriptor_update to keep the contract in sync")
        }

        // Commit: descriptor first, then declared edges (uses synced from it).
        if (hasDesc) {
          const set = yield* storeOp(() => store.setDescriptor(input.id, JSON.stringify(merged)))
          void set
          if (Array.isArray(merged!["uses"])) {
            const want = new Set(merged!["uses"].filter((item): item is string => typeof item === "string"))
            for (const dst of want) {
              let dstExists = true
              try {
                store.getNode(dst)
              } catch {
                dstExists = false
              }
              if (!dstExists) return yield* rollback(`descriptor.uses references missing node "${dst}"`)
              const edge = yield* storeOp(() =>
                store.addEdge({ src: input.id, dst, type: "uses", source: "declared", confidence: 1.0 }),
              )
              void edge
            }
            for (const edge of store.edgesFrom(input.id, ["uses"]))
              if (edge.source === "declared" && !want.has(edge.dst))
                store.removeEdge(input.id, edge.dst, "uses", "declared")
          }
        }
        if (hasEdges) {
          const applied = yield* storeOp(() => {
            for (const update of input.edge_updates!) {
              if (!(GraphStore.EDGE_TYPES as ReadonlyArray<string>).includes(update.type))
                throw new GraphStore.GraphError(`unknown edge type "${update.type}"`)
              if (update.type === "uses")
                throw new GraphStore.GraphError("uses is managed through descriptor.uses, not edge_updates")
              if (update.op === "add")
                store.addEdge({
                  src: input.id,
                  dst: update.dst,
                  type: update.type as EdgeType,
                  source: "declared",
                  confidence: 1.0,
                })
              else store.removeEdge(input.id, update.dst, update.type as EdgeType, "declared")
            }
          })
          void applied
        }

        // Own-write rule: entries that were in sync keep reading as in sync.
        for (const [entryId, preHash] of preStore) {
          if (preHash !== preSeen.get(entryId)) continue // was already stale
          try {
            const after = store.getNode(entryId)
            if (after.contentHash) graph.workingSet(context.sessionID).refreshSeen(entryId, after.contentHash)
          } catch {
            // gone: skip
          }
        }

        // Result: the diff of the edited body (never a re-render of the file).
        let out = ""
        if (hasBody) {
          let after: Node
          try {
            after = store.getNode(input.id)
          } catch {
            return yield* text("error: node vanished after edit")
          }
          out += `edited ${input.id} (${file} L${after.anchor!.startLine}-L${after.anchor!.endLine}, ${newBody.length} bytes)\n`
          out += lineDiff(oldBody, newBody)
        } else {
          out += `updated ${input.id} (descriptor/edges only)\n`
        }
        for (const warning of warnings) out += `warning: ${warning}\n`
        return yield* text(out)
      })

    // --- tool registration -----------------------------------------------------

    yield* ctx.tool
      .transform((editor) => {
        const add = (
          name: string,
          description: string,
          input: any,
          execute: (input: any, context: ToolCtx) => Effect.Effect<{ content: string }, ToolFailure>,
        ) =>
          editor.add({
            name,
            options: { codemode: false },
            description,
            input,
            execute: (input, context) => execute(input, context),
          })

        // search_graph
        add(
          "search_graph",
          "Full-text (BM25) search over node descriptors: summary, purpose, and the rest of the " +
            "contract. Use it to find nodes by what they are for. Plain words, implicit AND. Returns " +
            "node ids suitable for inspect() or neighbors().",
          InputSearchGraph,
          (input) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
              const hits = graph.store.searchDescriptors(input.query, limit)
              if (hits.length === 0) return yield* text(`no matches for "${input.query}"`)
              const lines = [`${hits.length} matches for "${input.query}":`]
              for (const hit of hits) {
                let line = `  ${hit.id}  (score ${hit.score})`
                if (hit.summary) line += `  ${hit.summary}`
                lines.push(line)
              }
              return yield* text(lines.join("\n"))
            }),
        )

        // inspect
        add(
          "inspect",
          'Inspect one graph node. Tiers: "stub" = identity + anchor + summary; "contract" = full ' +
            "descriptor JSON; \"body\" = contract + the node's source text. Start at stub, go to body " +
            "only when needed.",
          InputInspect,
          (input) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              const tier = input.tier ?? "body"
              const node = yield* storeOp(() => graph.store.getNode(input.id)).pipe(Effect.orElseSucceed(() => undefined))
              if (!node) return yield* text(`error: no node "${input.id}"`)
              if (tier === "stub") {
                const lines = [
                  `id: ${node.id}`,
                  `kind: ${node.kind}  status: ${node.status}`,
                  `parent: ${node.parent ?? "(none)"}`,
                  `anchor: ${anchorText(node)}`,
                ]
                const summary = summaryOf(node)
                if (summary) lines.push(`summary: ${summary}`)
                return yield* text(lines.join("\n"))
              }
              if (tier === "contract") return yield* text(node.descriptorJson ?? "(no descriptor)")
              if (!node.anchor) return yield* text("error: node is a skeleton (no body yet)")
              const body = nodeBody(node, graph.projectRoot)
              if (body === undefined) return yield* text(`error: source file ${node.anchor.file} missing on disk`)
              let bodyText = body
              if (bodyText.length > INSPECT_BODY_CAP)
                bodyText = `${bodyText.slice(0, INSPECT_BODY_CAP)}\n[... ${body.length - INSPECT_BODY_CAP} bytes truncated; total ${body.length} ...]`
              const header = `${node.anchor.file} L${node.anchor.startLine}-L${node.anchor.endLine} (${body.length} bytes):`
              const contract = node.descriptorJson ? `contract:\n${node.descriptorJson}\n\n` : ""
              return yield* text(`${contract}${header}\n${bodyText}`)
            }),
        )

        // neighbors
        add(
          "neighbors",
          "Breadth-first walk over typed edges (calls, imports, extends, implements, uses, tested_by, " +
            "reads_config, co_changes_with) from a node, both directions. Hub nodes (very high degree) " +
            "are reported as ids only. Output is cut at the token budget.",
          InputNeighbors,
          (input) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              const store = graph.store
              try {
                store.getNode(input.id)
              } catch {
                return yield* text(`error: no node "${input.id}"`)
              }
              const types: Array<EdgeType> = []
              for (const t of input.edge_types ?? []) {
                if (!(GraphStore.EDGE_TYPES as ReadonlyArray<string>).includes(t))
                  return yield* text(`error: unknown edge type "${t}"`)
                types.push(t as EdgeType)
              }
              const depth = Math.min(Math.max(input.depth ?? 1, 1), 3)
              const budget = Math.min(Math.max(input.token_budget ?? 2000, 100), 8000)
              // ponytail: hub threshold fixed at 20 in+out edges; per-project tuning if
              // real graphs drown the output.
              const hubDegree = 20

              const visited = new Set<string>([input.id])
              let frontier = [input.id]
              const lines: Array<string> = []
              let tokens = 0
              let found = 0
              let cut = false

              for (let level = 0; level < depth && frontier.length > 0 && !cut; level++) {
                const cands: Array<{ conf: number; other: string; out: boolean; type: EdgeType }> = []
                for (const f of frontier) {
                  for (const edge of store.edgesFrom(f, types))
                    if (!visited.has(edge.dst)) cands.push({ conf: edge.confidence, other: edge.dst, out: true, type: edge.type })
                  for (const edge of store.edgesTo(f, types))
                    if (!visited.has(edge.src)) cands.push({ conf: edge.confidence, other: edge.src, out: false, type: edge.type })
                }
                cands.sort((a, b) => b.conf - a.conf)
                frontier = []
                for (const cand of cands) {
                  if (visited.has(cand.other)) continue // reached twice this level
                  visited.add(cand.other)
                  frontier.push(cand.other)
                  let node: Node
                  try {
                    node = store.getNode(cand.other)
                  } catch {
                    continue // dangling endpoint (defensive; FKs prevent this)
                  }
                  const degree = store.edgesFrom(cand.other).length + store.edgesTo(cand.other).length
                  let line: string
                  if (degree >= hubDegree) {
                    line = `  ${cand.other}  (hub, ${degree} edges — skipped, inspect if needed)`
                  } else {
                    line = `  ${cand.other}  ${node.kind}  via ${cand.type} ${cand.out ? "out" : "in"}  conf ${cand.conf}`
                    const summary = summaryOf(node)
                    if (summary) line += `  ${summary}`
                  }
                  const lineTokens = Math.floor(line.length / 4) + 1
                  if (tokens + lineTokens > budget) {
                    cut = true
                    break
                  }
                  tokens += lineTokens
                  lines.push(line)
                  found++
                }
              }

              const header = `neighbors of ${input.id} (depth ${depth}):`
              if (lines.length === 0) return yield* text(`${header} none`)
              let tail = `\n(${found} nodes, ~${tokens} tokens)`
              if (cut) tail += " — budget reached, raise token_budget or shrink depth"
              return yield* text(`${header}\n${lines.join("\n")}${tail}`)
            }),
        )

        // open_node / pin_node / close_node
        add(
          "open_node",
          "Load a node's body into the working set, rendered at the end of every turn. Re-opening " +
            "refreshes recency. Chunk cap is 16 KB per node — open children instead of huge nodes. The " +
            "ack is one line; the body itself arrives in the working-set block.",
          InputId,
          (input, context) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              const ack = graph.workingSet(context.sessionID).open(input.id, graph.store, graph.projectRoot)
              return yield* text(ack)
            }),
        )
        add(
          "pin_node",
          "Open a node (if needed) and pin it: pinned chunks are never auto-demoted when the working " +
            "set overflows. Closing clears a pin.",
          InputId,
          (input, context) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              return yield* text(graph.workingSet(context.sessionID).pin(input.id, graph.store, graph.projectRoot))
            }),
        )
        add(
          "close_node",
          "Demote a working-set chunk to a stub. Requires a one-line takeaway: what you learned from " +
            "the body, so it survives the close.",
          InputCloseNode,
          (input, context) =>
            Effect.gen(function* () {
              const ws = graph.workingSet(context.sessionID)
              const out = ws.close(input.id, input.takeaway)
              // With a task the takeaway also lands in the scratchpad (L2); it
              // survives rotation even after this working-set entry does.
              if (!out.startsWith("error:")) {
                const task = subTasks.get(context.sessionID) ?? graph.store.getActiveTask()
                if (task)
                  yield* storeOp(() => graph.store.appendScratch(task.id, task.era, input.id, input.takeaway)).pipe(
                    Effect.orElseSucceed(() => undefined),
                  )
              }
              return yield* text(out)
            }),
        )

        // create_node
        add(
          "create_node",
          "Create a skeleton node in the graph. Kinds: directory | file | module | class | function | " +
            "method | attribute | config | test | region | external. kind=directory also creates the " +
            "folder on disk (id ends with '/'); use it for every directory in a new project before " +
            "creating files inside. Ids follow the ingest conventions: file under a directory parent " +
            "is parent-path + name (e.g. inv/models.py); a definition under a file is file::name; a " +
            "nested def is dotted. With optional body: the body text is appended to the parent's file " +
            "and the node is anchored there (asks the user for permission). Write the signature + stub " +
            "body yourself (pass, {}, todo!()); real implementations are edit_node's job, not this. " +
            "The descriptor must be COMPLETE at creation: summary and purpose (non-empty strings) " +
            "plus inputs, outputs, side_effects, invariants, uses (arrays, may be empty).",
          InputCreateNode,
          (input, context) =>
            Effect.gen(function* () {
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              const store = graph.store
              const descriptorJson = input.descriptor === undefined ? undefined : JSON.stringify(input.descriptor)
              if (descriptorJson !== undefined) {
                const complete = GraphDescriptor.descriptorComplete(descriptorJson)
                if (!complete.ok)
                  return yield* text(`error: descriptor incomplete — missing/empty fields: ${complete.missing}`)
              }
              if (!(GraphStore.KINDS as ReadonlyArray<string>).includes(input.kind))
                return yield* text(`error: unknown kind "${input.kind}"`)
              const kind = input.kind as GraphStore.Kind

              let parent: Node
              try {
                parent = store.getNode(input.parent)
              } catch {
                return yield* text(`error: no node "${input.parent}"`)
              }

              // Id follows the ingest conventions: file directly under root or a
              // dir (dir/ prefix), def under file::chain, sub-def dotted, dirs trailing '/'.
              let id: string
              if (input.parent === ".") id = input.name
              else if (parent.kind === "file") id = `${input.parent}::${input.name}`
              else if (input.parent.endsWith("/")) id = `${input.parent}${input.name}`
              else id = `${input.parent}.${input.name}`

              // Subagent node budget: refuse past it so the subagent stops and reports.
              if (context.agent === treeSub) {
                const charged = graph.chargeNode(context.sessionID)
                if (!charged.ok)
                  return yield* text(
                    `error: node budget exhausted (${charged.used}/${graph.subagentNodeBudget} nodes) — stop and report what you completed`,
                  )
              }

              if (kind === "directory") {
                if (parent.kind === "file")
                  return yield* text(`error: a directory cannot live inside a file "${input.parent}"`)
                if (input.parent !== "." && !input.parent.endsWith("/")) id = `${input.parent}/${input.name}/`
                else id = `${id}/`
                if (input.body) return yield* text("error: directory nodes take no body")
                yield* storeOp(() => {
                  mkdirSync(join(graph.projectRoot, id), { recursive: true })
                  store.createNode({
                    id,
                    kind,
                    parent: input.parent,
                    ord: store.children(input.parent).length,
                    status: "skeleton",
                  })
                  if (descriptorJson !== undefined) {
                    try {
                      store.setDescriptor(id, descriptorJson)
                    } catch (error) {
                      store.deleteSubtree(id)
                      throw error
                    }
                  }
                })
                return yield* text(`created ${id} (directory, on disk)`)
              }

              yield* storeOp(() => {
                store.createNode({
                  id,
                  kind,
                  parent: input.parent,
                  ord: store.children(input.parent).length,
                  status: "skeleton",
                })
                if (descriptorJson !== undefined) {
                  try {
                    store.setDescriptor(id, descriptorJson)
                  } catch (error) {
                    store.deleteSubtree(id)
                    throw error
                  }
                }
              })

              // Optional body: append to the parent's file and anchor the node.
              if (input.body) {
                if (!parent.anchor)
                  return yield* text(`created ${id} (skeleton) — parent has no anchor; body not written`)
                const file = parent.anchor.file
                const anchor = yield* appendToFile(file, input.body, context, id)
                yield* storeOp(() => store.setAnchor(id, { file, ...anchor }, GraphHash.hashText(input.body)))
                return yield* text(
                  `created ${id} (${kind}, anchored in ${file} L${anchor.startLine}-L${anchor.endLine}, ${input.body.length} bytes appended)`,
                )
              }
              return yield* text(`created ${id} (${kind}, skeleton)`)
            }),
        )

        // edit_node
        add(
          "edit_node",
          "The only way to modify code. Splices the node's body (or creates a skeleton file / appends " +
            "a skeleton's stub), re-parses the graph, and re-anchors everything. Guards: the node must " +
            "be open in your working set and unmodified on disk; signatures and inputs/outputs in the " +
            "edited subtree are frozen (contract changes are rejected); every new dependency must be " +
            "declared in descriptor.uses; after the merge the descriptor must be COMPLETE — summary " +
            "and purpose (non-empty strings) plus inputs, outputs, side_effects, invariants, uses " +
            "(arrays, may be empty) — pass every missing field in one call. The result is a small " +
            "diff, not the whole file. Skeleton file: new_body is the entire file text. Skeleton " +
            "definition: new_body is signature + stub body in the target language (pass, {}, todo!()), " +
            "appended to the file. Nested skeletons are edited through their parent.",
          InputEditNode,
          (input, context) => editNode(input, context),
        )

        // define_task
        add(
          "define_task",
          "Opens a task: goal (required), the subtree root_nodes this task owns, behavioral_change " +
            "(what must be different, stated as behavior), constraints (interfaces that must not " +
            "change, style/performance limits) and return_format. Refused while another task is " +
            "active. Acceptance criteria are managed with set_acceptance, not here. Journal progress " +
            "with journal_append; close with finish_task.",
          InputDefineTask,
          (input) =>
            Effect.gen(function* () {
              const store = graph.store
              const active = store.getActiveTask()
              if (active) return yield* text(`error: task ${active.id} is already active — finish_task before opening another`)
              const def: Record<string, unknown> = { goal: input.goal.trim() }
              if (input.root_nodes !== undefined) {
                for (const root of input.root_nodes) {
                  try {
                    store.getNode(root)
                  } catch {
                    return yield* text(`error: no node "${root}"`)
                  }
                }
                def["root_nodes"] = input.root_nodes
              }
              if (input.behavioral_change !== undefined) def["behavioral_change"] = input.behavioral_change
              if (input.constraints !== undefined) def["constraints"] = input.constraints
              if (input.return_format !== undefined) def["return_format"] = input.return_format
              const id = yield* storeOp(() => store.createTask(JSON.stringify(def)))
              return yield* text(`task ${id} active — journal_append as you go, finish_task when done`)
            }),
        )

        // journal_append
        add(
          "journal_append",
          "Records one progress entry in the active task's journal: decisions made, interfaces " +
            "changed, sub-steps done, blockers found. The journal survives context rotation — it is " +
            "your handoff notes to yourself. The harness refuses to rotate a transcript until the " +
            "journal is current.",
          InputJournalAppend,
          (input, context) =>
            Effect.gen(function* () {
              const store = graph.store
              // Inside a subagent run the entry lands in the sub task's journal;
              // otherwise the active top-level task is used.
              const task = subTasks.get(context.sessionID) ?? store.getActiveTask()
              if (!task) return yield* text("error: no active task — define_task first")
              yield* storeOp(() => store.appendJournal(task.id, task.era, input.entry.trim()))
              const journal = store.getJournal(task.id)
              return yield* text(`journaled (#${journal.at(-1)?.seq ?? 1})`)
            }),
        )

        // finish_task
        add(
          "finish_task",
          "Closes the active task: status is done or abandoned; result is the final report (any JSON). " +
            "The definition, journal, scratchpad, acceptance criteria and result are stashed in the " +
            "task ledger; the criteria table is cleared for the next task.",
          InputFinishTask,
          (input) =>
            Effect.gen(function* () {
              const store = graph.store
              const task = store.getActiveTask()
              if (!task) return yield* text("error: no active task")
              // Snapshot the criteria into the ledger row, then clear the table so the
              // next task starts clean (validate targets the designed subgraph anew).
              const criteria = store.getCriteria()
              yield* storeOp(() => {
                store.closeTask(
                  task.id,
                  input.status,
                  input.result === undefined ? undefined : JSON.stringify(input.result),
                  criteria.length === 0 ? undefined : JSON.stringify(criteria),
                )
                store.setCriteria([])
              })
              return yield* text(`task ${task.id} ${input.status} — stashed`)
            }),
        )

        // set_acceptance
        add(
          "set_acceptance",
          "Replaces the acceptance criteria that validate_skeleton checks. Each criterion: id (short " +
            "tag), text (what done means), covered_by (node ids that together implement it). Calling " +
            "it again replaces the whole list — rewrite it as the design evolves.",
          InputSetAcceptance,
          (input) =>
            Effect.gen(function* () {
              const criteria = input.criteria.map(
                (criterion: { id: string; text: string; covered_by?: Array<string> }) => ({
                  id: criterion.id,
                  text: criterion.text,
                  coveredBy: criterion.covered_by ?? [],
                }),
              )
              yield* storeOp(() => graph.store.setCriteria(criteria))
              return yield* text(`set ${criteria.length} acceptance criterion${criteria.length === 1 ? "" : "s"}`)
            }),
        )

        // validate_skeleton
        add(
          "validate_skeleton",
          "Runs the structural checks over the graph (or a subtree): declared dependencies resolve, " +
            "required descriptor fields are present, no forbidden dependency cycles, acceptance " +
            "criteria covered. While the stage is skeleton, a passing report advances it to validate; " +
            "a failing one keeps (or returns the stage to) skeleton.",
          InputValidateSkeleton,
          (input, context) =>
            Effect.gen(function* () {
              const store = graph.store
              const root = input.root ?? "."
              let report: GraphValidate.ValidationReport
              try {
                report = GraphValidate.validateGraph(store, root)
              } catch (error) {
                return yield* text(`error: ${error instanceof GraphStore.GraphError ? error.message : error}`)
              }
              const out = GraphValidate.reportText(report)
              // Subagents get a dry run only: stage transitions belong to the parent.
              if (context.agent === treeSub) return yield* text(`${out}(dry run — stage transitions belong to the parent)`)
              let result = out
              const stage = getStage(store)
              if (stage === "skeleton" || stage === "validate") {
                const next = GraphValidate.reportOk(report) ? "validate" : "skeleton"
                if (next !== stage) store.setMeta("stage", next)
                result += next === "validate" ? "stage advanced to validate" : "stage is skeleton (validation failed)"
              }
              return yield* text(result)
            }),
        )

        // set_stage
        add(
          "set_stage",
          "Moves the workflow stage: none (no gating) -> skeleton (design skeletons with create_node; " +
            "body edits on existing code are refused) -> validate (only reachable via a passing " +
            "validate_skeleton) -> slice (thin end-to-end path; body edits restricted to slice_roots) " +
            "-> fill (body edits unrestricted). slice re-validates and needs slice_roots; fill needs " +
            "every slice node materialized and fresh.",
          InputSetStage,
          (input) =>
            Effect.gen(function* () {
              const store = graph.store
              const target = parseStage(input.stage)
              if (!target) return yield* text(`error: unknown stage "${input.stage}"`)
              switch (target) {
                case "none":
                  store.setMeta("stage", "none")
                  return yield* text("stage: none")
                case "skeleton":
                  store.setMeta("stage", "skeleton")
                  return yield* text("stage: skeleton — design with create_node skeletons, then validate_skeleton")
                case "validate":
                  return yield* text("error: validate is reached only through a passing validate_skeleton")
                case "slice": {
                  const roots = input.slice_roots
                  if (!roots || roots.length === 0)
                    return yield* text("error: slice needs slice_roots (node ids of the vertical slice)")
                  for (const root of roots) {
                    try {
                      store.getNode(root)
                    } catch {
                      return yield* text(`error: no node "${root}"`)
                    }
                  }
                  let report: GraphValidate.ValidationReport
                  try {
                    report = GraphValidate.validateGraph(store, ".")
                  } catch (error) {
                    return yield* text(`error: ${error instanceof GraphStore.GraphError ? error.message : error}`)
                  }
                  if (!GraphValidate.reportOk(report))
                    return yield* text(
                      `error: the skeleton must pass validation before slicing\n${GraphValidate.reportText(report)}`,
                    )
                  store.setMeta("stage", "slice")
                  store.setMeta("slice_roots", JSON.stringify(roots))
                  return yield* text(`stage: slice (roots: ${joinList(roots)})`)
                }
                case "fill": {
                  if (getStage(store) !== "slice") return yield* text("error: set_stage fill requires stage slice")
                  const roots = getSliceRoots(store)
                  const bad: Array<string> = []
                  for (const root of roots) {
                    for (const node of store.subtree(root)) {
                      if (node.kind === "directory") continue
                      if (!node.anchor) bad.push(`${node.id} (skeleton)`)
                      else if (node.status === "stale") bad.push(`${node.id} (stale)`)
                    }
                  }
                  if (bad.length > 0)
                    return yield* text(
                      `error: the slice is not ready to fill — ${joinList(bad)}. Remedy: for each (stale) node: open_node it, then edit_node with descriptor_update repeating its FULL descriptor (summary, purpose, inputs, outputs, side_effects, invariants, uses) — that re-affirms the contract against the current body. For each (skeleton) node: edit_node with new_body to materialize it.`,
                    )
                  store.setMeta("stage", "fill")
                  return yield* text("stage: fill")
                }
              }
            }),
        )

        // spawn_subtree
        add(
          "spawn_subtree",
          "Delegate a locked subtree to a subagent (tree-sub). It owns the subtree (writes outside are " +
            "refused), sees its dependency contracts, and returns a short five-section report — never " +
            "its code or transcript. behavioral_change states what must be different, as behavior.",
          InputSpawnSubtree,
          (input, context) =>
            Effect.gen(function* () {
              const store = graph.store
              yield* graph.ready.pipe(Effect.orElseSucceed(() => undefined))
              for (const root of input.root_nodes) {
                try {
                  store.getNode(root)
                } catch {
                  return yield* text(`error: no node "${root}"`)
                }
              }
              // One sub task record owns the delegation; the lock owner is the child session.
              const parentTask = store.getActiveTask()
              const taskId = yield* storeOp(() =>
                store.createTask(
                  JSON.stringify({
                    goal: input.behavioral_change,
                    root_nodes: input.root_nodes,
                    ...(input.instructions ? { instructions: input.instructions } : {}),
                    return_format:
                      "changed: [ids] | interfaces: [changes] | contract_requests: [..] | unresolved: [..] | verification: [..]",
                  }),
                  parentTask?.id,
                ),
              )
              const child = yield* sessions
                .create({ parentID: context.sessionID, title: "tree subtree", agent: treeSub })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "error: could not create subagent session", error })))
              const attempt = yield* Effect.result(
                storeOp(() => {
                  for (const root of input.root_nodes) store.tryLock(root, child.id)
                }),
              )
              if (Result.isFailure(attempt)) {
                store.closeTask(taskId, "abandoned", JSON.stringify({ error: "lock refused" }))
                yield* sessions.remove(child.id).pipe(Effect.orDie)
                return yield* text(`error: ${attempt.failure.message}`)
              }
              subTasks.set(child.id, store.getTask(taskId)!)

              const prompt = [
                `Task ${taskId}: ${input.behavioral_change}`,
                input.instructions ? `\nInstructions: ${input.instructions}` : "",
                `\nLocked subtree roots: ${joinList(input.root_nodes)}`,
                "Work the subtree, then reply with ONLY the five-section report.",
              ]
                .filter(Boolean)
                .join("\n")
              yield* sessions
                .prompt({ sessionID: child.id, text: prompt })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "error: failed to prompt subagent", error })))
              yield* context.progress({ status: "running", sessionID: child.id, task: taskId })

              // The job owns the child drain (resume on wake) and its result; without it
              // jobs.block finds nothing and the parent would read an empty report while
              // the subagent is still running.
              yield* subagents.start({
                kind: "subagent",
                parentSessionID: context.sessionID,
                childSessionID: child.id,
                agent: "Tree Sub",
                description: input.behavioral_change,
              })

              const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() =>
                  Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], { discard: true }),
                ),
              )

              // Release the subtree + close the sub task whatever happened.
              yield* storeOp(() => {
                for (const root of input.root_nodes) store.unlock(root, child.id)
              }).pipe(Effect.orElseSucceed(() => undefined))
              subTasks.delete(child.id)
              const status = result?.info.status === "error" || result?.info.status === "cancelled" ? "abandoned" : "done"
              store.closeTask(
                taskId,
                status,
                JSON.stringify({ output: result?.info.output ?? "", sessionID: child.id }),
              )

              if (result?.info.status === "error")
                return yield* new ToolFailure({
                  message: `error: subtree subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                })
              if (result?.info.status === "cancelled")
                return yield* new ToolFailure({ message: `error: subtree subagent cancelled (sessionID: ${child.id})` })
              return yield* text(result?.info.output ?? "(no report)")
            }),
        )
      })
      .pipe(Effect.orDie)
  }),
}
