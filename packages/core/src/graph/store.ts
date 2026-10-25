export * as GraphStore from "./store.js"

import { openRaw, type RawDatabase } from "#graph-sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

/** Thrown by store operations; tool boundaries map it to ToolFailure. */
export class GraphError extends Error {
  override readonly name = "GraphError"
}

export type Kind =
  | "directory"
  | "file"
  | "module"
  | "class"
  | "function"
  | "method"
  | "attribute"
  | "config"
  | "test"
  | "region"
  | "external"

export type Status = "skeleton" | "fresh" | "stale" | "needs_review" | "auto_generated" | "conflict"

export type EdgeType =
  | "calls"
  | "uses"
  | "extends"
  | "implements"
  | "reads_config"
  | "tested_by"
  | "imports"
  | "co_changes_with"

export type EdgeSource = "declared" | "parsed" | "lsp" | "git"

export const KINDS: readonly Kind[] = [
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
]
export const STATUSES: readonly Status[] = [
  "skeleton",
  "fresh",
  "stale",
  "needs_review",
  "auto_generated",
  "conflict",
]
export const EDGE_TYPES: readonly EdgeType[] = [
  "calls",
  "uses",
  "extends",
  "implements",
  "reads_config",
  "tested_by",
  "imports",
  "co_changes_with",
]
export const EDGE_SOURCES: readonly EdgeSource[] = ["declared", "parsed", "lsp", "git"]

export interface Anchor {
  readonly file: string
  readonly startByte: number
  readonly endByte: number
  readonly startLine: number
  readonly endLine: number
}

export interface Node {
  readonly id: string
  kind: Kind
  /** Undefined only for the containment root ".". */
  parent?: string
  ord: number
  /** Absent while a node is a skeleton. */
  anchor?: Anchor
  contentHash?: string
  status: Status
  lockOwner?: string
  descriptorJson?: string
  sourceHash?: string
}

export interface Edge {
  readonly src: string
  readonly dst: string
  readonly type: EdgeType
  readonly source: EdgeSource
  readonly confidence: number
}

/** An anchored node handed to `rebuild` by the ingestion pass. */
export interface NodeSpec {
  readonly id: string
  readonly parent: string
  readonly kind: Kind
  readonly ord: number
  readonly anchor: Anchor
  readonly contentHash: string
}

/** A parsed edge handed to `rebuild`; its source is always `parsed`. */
export interface EdgeSpec {
  readonly src: string
  readonly dst: string
  readonly type: EdgeType
  readonly confidence: number
}

export interface SearchHit {
  readonly id: string
  readonly score: number
  readonly summary: string
}

/** One acceptance criterion; `coveredBy` lists node ids that implement it. */
export interface Criterion {
  readonly id: string
  readonly text: string
  readonly coveredBy: readonly string[]
}

export interface TaskRecord {
  readonly id: string
  parent?: string
  readonly status: "active" | "done" | "abandoned"
  readonly definitionJson: string
  acceptanceJson?: string
  resultJson?: string
  era: number
  readonly createdAt: number
  closedAt?: number
}

export interface JournalEntry {
  readonly seq: number
  readonly era: number
  readonly text: string
  readonly at: number
}

export interface ScratchEntry {
  readonly seq: number
  readonly era: number
  readonly node: string
  readonly takeaway: string
}

const NODE_COLS =
  "id, kind, parent, ord, anchor_file, start_byte, end_byte, start_line, end_line, content_hash, status, lock_owner, descriptor_json, source_hash"
const NODE_COLS_Q = `n.${NODE_COLS.replaceAll(", ", ", n.")}`
const TASK_COLS =
  "id, parent, status, definition_json, acceptance_json, result_json, era, created_at, closed_at"

// Self + ancestors, ?1 = start node; rows come nearest-first.
const ANCESTOR_CTE =
  "WITH RECURSIVE anc(id, parent, lock_owner) AS (" +
  "  SELECT id, parent, lock_owner FROM nodes WHERE id = ?1" +
  "  UNION ALL" +
  "  SELECT n.id, n.parent, n.lock_owner FROM nodes n JOIN anc ON n.id = anc.parent)"

// `WITH RECURSIVE sub(id) AS (...)` over the containment tree, ?1 = subtree root.
const SUBTREE_CTE =
  "WITH RECURSIVE sub(id) AS (" +
  "  SELECT id FROM nodes WHERE id = ?1" +
  "  UNION ALL" +
  "  SELECT n.id FROM nodes n JOIN sub ON n.parent = sub.id)"

const now = () => Math.floor(Date.now() / 1000)

const validateDescriptor = (json: string | undefined) => {
  if (json === undefined) return
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new GraphError("descriptor must be a JSON object")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new GraphError("descriptor must be a JSON object")
}

interface RawNode {
  id: string
  kind: string
  parent: string | null
  ord: number
  anchor_file: string | null
  start_byte: number | null
  end_byte: number | null
  start_line: number | null
  end_line: number | null
  content_hash: string | null
  status: string
  lock_owner: string | null
  descriptor_json: string | null
  source_hash: string | null
}

const rowToNode = (row: RawNode): Node => {
  if (!KINDS.includes(row.kind as Kind)) throw new GraphError(`corrupt store: bad kind in node ${row.id}`)
  if (!STATUSES.includes(row.status as Status))
    throw new GraphError(`corrupt store: bad status in node ${row.id}`)
  return {
    id: row.id,
    kind: row.kind as Kind,
    parent: row.parent === null ? undefined : row.parent,
    ord: row.ord,
    anchor:
      row.anchor_file === null
        ? undefined
        : {
            file: row.anchor_file,
            startByte: row.start_byte!,
            endByte: row.end_byte!,
            startLine: row.start_line!,
            endLine: row.end_line!,
          },
    contentHash: row.content_hash === null ? undefined : row.content_hash,
    status: row.status as Status,
    lockOwner: row.lock_owner === null ? undefined : row.lock_owner,
    descriptorJson: row.descriptor_json === null ? undefined : row.descriptor_json,
    sourceHash: row.source_hash === null ? undefined : row.source_hash,
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'directory','file','module','class','function','method',
    'attribute','config','test','region','external')),
  parent TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL DEFAULT 0,
  anchor_file TEXT,
  start_byte INTEGER, end_byte INTEGER, start_line INTEGER, end_line INTEGER,
  content_hash TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'skeleton','fresh','stale','needs_review','auto_generated','conflict')),
  lock_owner TEXT,
  descriptor_json TEXT,
  source_hash TEXT,
  -- anchors are all-or-none: a skeleton has none, a real node has all five
  CHECK ((anchor_file IS NULL AND start_byte IS NULL AND end_byte IS NULL
      AND start_line IS NULL AND end_line IS NULL)
    OR (anchor_file IS NOT NULL AND start_byte IS NOT NULL AND end_byte IS NOT NULL
      AND start_line IS NOT NULL AND end_line IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'calls','uses','extends','implements','reads_config','tested_by',
    'imports','co_changes_with')),
  source TEXT NOT NULL CHECK (source IN ('declared','parsed','lsp','git')),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
CREATE UNIQUE INDEX IF NOT EXISTS edges_key ON edges(src, dst, type, source);
CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
  id, summary, purpose, rest, tokenize = 'unicode61'
);
CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes
  WHEN NEW.descriptor_json IS NOT NULL BEGIN
    INSERT INTO node_fts(id, summary, purpose, rest) VALUES (
      NEW.id,
      COALESCE(json_extract(NEW.descriptor_json, '$.summary'), ''),
      COALESCE(json_extract(NEW.descriptor_json, '$.purpose'), ''),
      NEW.descriptor_json);
  END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM node_fts WHERE id = OLD.id;
  END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE OF descriptor_json ON nodes BEGIN
    DELETE FROM node_fts WHERE id = OLD.id;
    INSERT INTO node_fts(id, summary, purpose, rest)
      SELECT NEW.id,
             COALESCE(json_extract(NEW.descriptor_json, '$.summary'), ''),
             COALESCE(json_extract(NEW.descriptor_json, '$.purpose'), ''),
             NEW.descriptor_json
      WHERE NEW.descriptor_json IS NOT NULL;
  END;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  covered_by TEXT NOT NULL  -- JSON array of node ids
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  parent TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','done','abandoned')),
  definition_json TEXT NOT NULL,
  acceptance_json TEXT,
  result_json TEXT,
  era INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS journal (
  task TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  era INTEGER NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scratch (
  task TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  era INTEGER NOT NULL,
  node TEXT NOT NULL,
  takeaway TEXT NOT NULL
);
`

const SCHEMA_VERSION = 3

export class Store {
  private readonly db: RawDatabase

  private constructor(db: RawDatabase) {
    this.db = db
  }

  /** Opens (creating, including parent directories) the store at db_path. */
  static open(dbPath: string): Store {
    const parent = dirname(dbPath)
    if (parent) mkdirSync(parent, { recursive: true })
    const db = openRaw(dbPath)
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA journal_mode = WAL")
    const store = new Store(db)
    store.applySchema()
    return store
  }

  /** In-memory store, for tests. */
  static openMemory(): Store {
    const db = openRaw(":memory:")
    db.run("PRAGMA foreign_keys = ON")
    const store = new Store(db)
    store.applySchema()
    return store
  }

  close(): void {
    this.db.close()
  }

  private applySchema(): void {
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version
    if (version > SCHEMA_VERSION)
      throw new GraphError(
        `store schema v${version} is newer than this build; upgrade or delete the graph database`,
      )
    this.db.run(SCHEMA)
    if (version < SCHEMA_VERSION) this.db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    // Containment root, one per store.
    this.db.run("INSERT OR IGNORE INTO nodes(id, kind, parent, status) VALUES('.', 'directory', NULL, 'skeleton')")
  }

  private exists(id: string): boolean {
    return this.db.query("SELECT 1 AS ok FROM nodes WHERE id = ?").get(id) !== null
  }

  private insertNodeRaw(n: Node): void {
    this.db
      .query(
        `INSERT INTO nodes(${NODE_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
      )
      .run(
        n.id,
        n.kind,
        n.parent ?? null,
        n.ord,
        n.anchor?.file ?? null,
        n.anchor?.startByte ?? null,
        n.anchor?.endByte ?? null,
        n.anchor?.startLine ?? null,
        n.anchor?.endLine ?? null,
        n.contentHash ?? null,
        n.status,
        n.lockOwner ?? null,
        n.descriptorJson ?? null,
        n.sourceHash ?? null,
      )
  }

  createNode(node: Node): void {
    if (!node.id) throw new GraphError("node id must not be empty")
    if (node.id === ".") throw new GraphError("'.' is the reserved root id")
    validateDescriptor(node.descriptorJson)
    if (node.parent && !this.exists(node.parent))
      throw new GraphError(`parent does not exist: ${node.parent}`)
    if (this.exists(node.id)) throw new GraphError(`node already exists: ${node.id}`)
    this.insertNodeRaw(node)
  }

  getNode(id: string): Node {
    const row = this.db.query(`SELECT ${NODE_COLS} FROM nodes WHERE id = ?`).get(id) as RawNode | null
    if (!row) throw new GraphError(`no such node: ${id}`)
    return rowToNode(row)
  }

  updateNode(node: Node): void {
    if (!this.exists(node.id)) throw new GraphError(`no such node: ${node.id}`)
    validateDescriptor(node.descriptorJson)
    if (node.parent && !this.exists(node.parent))
      throw new GraphError(`parent does not exist: ${node.parent}`)
    this.db
      .query(
        "UPDATE nodes SET kind=?2, parent=?3, ord=?4, anchor_file=?5, start_byte=?6, " +
          "end_byte=?7, start_line=?8, end_line=?9, content_hash=?10, status=?11, " +
          "lock_owner=?12, descriptor_json=?13, source_hash=?14 WHERE id=?1",
      )
      .run(
        node.id,
        node.kind,
        node.parent ?? null,
        node.ord,
        node.anchor?.file ?? null,
        node.anchor?.startByte ?? null,
        node.anchor?.endByte ?? null,
        node.anchor?.startLine ?? null,
        node.anchor?.endLine ?? null,
        node.contentHash ?? null,
        node.status,
        node.lockOwner ?? null,
        node.descriptorJson ?? null,
        node.sourceHash ?? null,
      )
  }

  /** Fills anchor + content_hash; status becomes fresh if a descriptor exists. */
  setAnchor(id: string, anchor: Anchor, contentHash: string): void {
    const result = this.db
      .query(
        "UPDATE nodes SET anchor_file=?2, start_byte=?3, end_byte=?4, start_line=?5, " +
          "end_line=?6, content_hash=?7, source_hash = COALESCE(source_hash, ?7), " +
          "status = CASE WHEN status = 'skeleton' AND descriptor_json IS NOT NULL " +
          "THEN 'fresh' ELSE status END " +
          "WHERE id=?1",
      )
      .run(id, anchor.file, anchor.startByte, anchor.endByte, anchor.startLine, anchor.endLine, contentHash)
    if (result.changes === 0) throw new GraphError(`no such node: ${id}`)
  }

  /** Deletes the node and its whole subtree, with their edges and FTS rows. */
  deleteSubtree(id: string): void {
    if (id === ".") throw new GraphError("cannot delete the root")
    this.db.run(`${SUBTREE_CTE} DELETE FROM nodes WHERE id IN (SELECT id FROM sub)`, [id])
  }

  children(id: string): Array<Node> {
    return (
      this.db.query(`SELECT ${NODE_COLS} FROM nodes WHERE parent = ?1 ORDER BY ord, id`).all(id) as RawNode[]
    ).map(rowToNode)
  }

  subtree(id: string): Array<Node> {
    return (
      this.db
        .query(
          "WITH RECURSIVE sub(id, depth) AS (" +
            "  SELECT id, 0 FROM nodes WHERE id = ?1" +
            "  UNION ALL" +
            "  SELECT n.id, sub.depth + 1 FROM nodes n JOIN sub ON n.parent = sub.id) " +
            `SELECT ${NODE_COLS_Q}, sub.depth FROM nodes n JOIN sub ON n.id = sub.id ` +
            "ORDER BY sub.depth, n.id",
        )
        .all(id) as RawNode[]
    ).map(rowToNode)
  }

  ancestors(id: string): Array<Node> {
    return (
      this.db
        .query(
          `${ANCESTOR_CTE} SELECT ${NODE_COLS_Q} FROM nodes n JOIN anc ON n.id = anc.id WHERE anc.id != ?1`,
        )
        .all(id) as RawNode[]
    ).map(rowToNode)
  }

  setDescriptor(id: string, json: string): void {
    validateDescriptor(json)
    if (!this.exists(id)) throw new GraphError(`no such node: ${id}`)
    this.db
      .query(
        "UPDATE nodes SET descriptor_json=?2, source_hash = content_hash, " +
          "status = CASE WHEN anchor_file IS NULL THEN 'skeleton' ELSE 'fresh' END " +
          "WHERE id=?1",
      )
      .run(id, json)
  }

  /** BM25 over descriptors; query is sanitized to quoted alnum tokens (implicit AND). */
  searchDescriptors(query: string, limit = 20): Array<SearchHit> {
    const tokens: Array<string> = []
    for (const match of query.toLowerCase().match(/[a-z0-9]+/g) ?? []) tokens.push(match)
    if (tokens.length === 0) return []
    const fts = tokens.map((token) => `"${token}"`).join(" ")
    const rows = this.db
      .query(
        "SELECT id, summary, bm25(node_fts, 2.0, 5.0, 2.0, 1.0) AS score " +
          "FROM node_fts WHERE node_fts MATCH ?1 " +
          "ORDER BY bm25(node_fts, 2.0, 5.0, 2.0, 1.0), id LIMIT ?2",
      )
      .all(fts, limit) as Array<{ id: string; summary: string; score: number }>
    return rows.map((row) => ({ id: row.id, score: row.score, summary: row.summary }))
  }

  addEdge(edge: Edge): void {
    if (!this.exists(edge.src)) throw new GraphError(`edge source does not exist: ${edge.src}`)
    if (!this.exists(edge.dst)) throw new GraphError(`edge target does not exist: ${edge.dst}`)
    if (!(edge.confidence >= 0 && edge.confidence <= 1))
      throw new GraphError("edge confidence must be within [0, 1]")
    this.db
      .query(
        "INSERT INTO edges(src, dst, type, source, confidence) VALUES (?1,?2,?3,?4,?5) " +
          "ON CONFLICT(src, dst, type, source) DO UPDATE SET confidence = excluded.confidence",
      )
      .run(edge.src, edge.dst, edge.type, edge.source, edge.confidence)
  }

  removeEdge(src: string, dst: string, type: EdgeType, source: EdgeSource): void {
    this.db.query("DELETE FROM edges WHERE src=?1 AND dst=?2 AND type=?3 AND source=?4").run(
      src,
      dst,
      type,
      source,
    )
  }

  private edges(column: "src" | "dst", id: string): Array<Edge> {
    const rows = this.db
      .query(
        `SELECT src, dst, type, source, confidence FROM edges WHERE ${column} = ?1 ORDER BY src, dst, type, source`,
      )
      .all(id) as Array<{ src: string; dst: string; type: string; source: string; confidence: number }>
    return rows.map((row) => {
      if (!EDGE_TYPES.includes(row.type as EdgeType) || !EDGE_SOURCES.includes(row.source as EdgeSource))
        throw new GraphError("corrupt store: bad edge type/source")
      return { src: row.src, dst: row.dst, type: row.type as EdgeType, source: row.source as EdgeSource, confidence: row.confidence }
    })
  }

  edgesFrom(src: string, types: ReadonlyArray<EdgeType> = []): Array<Edge> {
    const all = this.edges("src", src)
    return types.length === 0 ? all : all.filter((edge) => types.includes(edge.type))
  }

  edgesTo(dst: string, types: ReadonlyArray<EdgeType> = []): Array<Edge> {
    const all = this.edges("dst", dst)
    return types.length === 0 ? all : all.filter((edge) => types.includes(edge.type))
  }

  /** Claims root + subtree for owner. Idempotent for the same owner; refused if held elsewhere. */
  tryLock(root: string, owner: string): void {
    if (!this.exists(root)) throw new GraphError(`no such node: ${root}`)
    // An ancestor (or the node itself) held by someone else?
    const ancestor = this.db
      .query(`${ANCESTOR_CTE} SELECT id, lock_owner FROM anc WHERE lock_owner IS NOT NULL LIMIT 1`)
      .get(root) as { id: string; lock_owner: string } | null
    if (ancestor) {
      if (ancestor.lock_owner !== owner)
        throw new GraphError(`node ${root} is locked by task ${ancestor.lock_owner}`)
      return // already held by this owner — idempotent
    }
    // Any descendant held by someone else?
    const descendant = this.db
      .query(
        `${SUBTREE_CTE} SELECT id, lock_owner FROM nodes WHERE id IN (SELECT id FROM sub) ` +
          "AND lock_owner IS NOT NULL AND lock_owner != ?2 LIMIT 1",
      )
      .get(root, owner) as { id: string; lock_owner: string } | null
    if (descendant)
      throw new GraphError(`node ${descendant.id} inside ${root} is locked by task ${descendant.lock_owner}`)
    this.db.run(`${SUBTREE_CTE} UPDATE nodes SET lock_owner = ?2 WHERE id IN (SELECT id FROM sub)`, [root, owner])
  }

  unlock(root: string, owner: string): void {
    this.db.run(
      `${SUBTREE_CTE} UPDATE nodes SET lock_owner = NULL WHERE id IN (SELECT id FROM sub) AND lock_owner = ?2`,
      [root, owner],
    )
  }

  unlockAll(owner: string): void {
    this.db.query("UPDATE nodes SET lock_owner = NULL WHERE lock_owner = ?1").run(owner)
  }

  /** The node's own lock or the nearest ancestor's; undefined when unlocked. */
  lockHolder(id: string): string | undefined {
    const row = this.db
      .query(`${ANCESTOR_CTE} SELECT lock_owner FROM anc WHERE lock_owner IS NOT NULL LIMIT 1`)
      .get(id) as { lock_owner: string } | null
    return row?.lock_owner
  }

  getMeta(key: string): string | undefined {
    const row = this.db.query("SELECT value FROM meta WHERE key = ?1").get(key) as { value: string } | null
    return row?.value
  }

  setMeta(key: string, value: string): void {
    this.db
      .query("INSERT INTO meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value)
  }

  setCriteria(criteria: ReadonlyArray<Criterion>): void {
    for (const criterion of criteria) {
      if (!criterion.id || !criterion.text) throw new GraphError("criterion id and text must not be empty")
    }
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM criteria")
      criteria.forEach((criterion, ord) => {
        this.db
          .query("INSERT INTO criteria(id, ord, text, covered_by) VALUES (?1,?2,?3,?4)")
          .run(criterion.id, ord, criterion.text, JSON.stringify(criterion.coveredBy))
      })
    })
    ;(tx as unknown as { immediate: () => void }).immediate()
  }

  getCriteria(): Array<Criterion> {
    const rows = this.db.query("SELECT id, text, covered_by FROM criteria ORDER BY ord, id").all() as Array<{
      id: string
      text: string
      covered_by: string
    }>
    return rows.map((row) => {
      let coveredBy: Array<string> = []
      try {
        const parsed: unknown = JSON.parse(row.covered_by)
        if (Array.isArray(parsed)) coveredBy = parsed.filter((item): item is string => typeof item === "string")
      } catch {
        throw new GraphError(`corrupt store: bad covered_by on criterion ${row.id}`)
      }
      return { id: row.id, text: row.text, coveredBy }
    })
  }

  // --- task ledger ---------------------------------------------------------------

  /** Creates an active task "T<n>"; parent for subagent tasks. */
  createTask(definitionJson: string, parent?: string): string {
    let id = "T1"
    const tx = this.db.transaction(() => {
      const row = this.db
        .query("SELECT COALESCE(MAX(CAST(substr(id, 2) AS INTEGER)), 0) + 1 AS next FROM tasks WHERE id LIKE 'T%'")
        .get() as { next: number }
      id = `T${row.next}`
      this.db
        .query("INSERT INTO tasks(id, parent, status, definition_json, era, created_at) VALUES (?1, ?2, 'active', ?3, 1, ?4)")
        .run(id, parent ?? null, definitionJson, now())
    })
    ;(tx as unknown as { immediate: () => void }).immediate()
    return id
  }

  private static taskRow(row: Record<string, unknown>): TaskRecord {
    return {
      id: row.id as string,
      parent: (row.parent as string | null) ?? undefined,
      status: row.status as TaskRecord["status"],
      definitionJson: row.definition_json as string,
      acceptanceJson: (row.acceptance_json as string | null) ?? undefined,
      resultJson: (row.result_json as string | null) ?? undefined,
      era: row.era as number,
      createdAt: row.created_at as number,
      closedAt: (row.closed_at as number | null) ?? undefined,
    }
  }

  /** The most recent active top-level task; undefined when none. */
  getActiveTask(): TaskRecord | undefined {
    const row = this.db
      .query(
        `SELECT ${TASK_COLS} FROM tasks WHERE status = 'active' AND parent IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get() as Record<string, unknown> | null
    return row ? Store.taskRow(row) : undefined
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.query(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?1`).get(id) as
      | Record<string, unknown>
      | null
    return row ? Store.taskRow(row) : undefined
  }

  closeTask(
    id: string,
    status: "done" | "abandoned",
    resultJson?: string,
    acceptanceJson?: string,
  ): void {
    this.db
      .query(
        "UPDATE tasks SET status = ?2, result_json = ?3, acceptance_json = COALESCE(?4, acceptance_json), closed_at = ?5 WHERE id = ?1",
      )
      .run(id, status, resultJson ?? null, acceptanceJson ?? null, now())
  }

  /** Rotation/resume: the task's era += 1; returns the new era. */
  bumpEra(id: string): number {
    this.db.query("UPDATE tasks SET era = era + 1 WHERE id = ?1").run(id)
    return this.getTask(id)?.era ?? 1
  }

  appendJournal(task: string, era: number, text: string): void {
    this.db
      .query(
        "INSERT INTO journal(task, seq, era, text, at) VALUES (?1, COALESCE((SELECT MAX(seq) + 1 FROM journal WHERE task = ?1), 1), ?2, ?3, ?4)",
      )
      .run(task, era, text, now())
  }

  getJournal(task: string): Array<JournalEntry> {
    return this.db
      .query("SELECT seq, era, text, at FROM journal WHERE task = ?1 ORDER BY seq")
      .all(task) as Array<JournalEntry>
  }

  appendScratch(task: string, era: number, node: string, takeaway: string): void {
    this.db
      .query(
        "INSERT INTO scratch(task, seq, era, node, takeaway) VALUES (?1, COALESCE((SELECT MAX(seq) + 1 FROM scratch WHERE task = ?1), 1), ?2, ?3, ?4)",
      )
      .run(task, era, node, takeaway)
  }

  getScratch(task: string): Array<ScratchEntry> {
    return this.db
      .query("SELECT seq, era, node, takeaway FROM scratch WHERE task = ?1 ORDER BY seq")
      .all(task) as Array<ScratchEntry>
  }

  /** Marks active subagent tasks abandoned — they cannot resume after a restart. */
  abandonActiveSubTasks(): number {
    const ids = (
      this.db.query("SELECT id FROM tasks WHERE status = 'active' AND parent IS NOT NULL").all() as Array<{
        id: string
      }>
    ).map((row) => row.id)
    for (const id of ids)
      this.closeTask(id, "abandoned", JSON.stringify({ error: "interrupted — host restarted mid-subagent" }))
    return ids.length
  }

  // --- rebuild -----------------------------------------------------------------

  /**
   * Replaces all anchored nodes and parsed edges from an ingestion pass, in one
   * transaction. `directories` is the caller's directory universe (the file walk):
   * missing ones are created parents-first; directory nodes not in the list are
   * pruned with their subtrees, EXCEPT directories on the parent chain of a
   * surviving skeleton — skeletons are never dropped by ingestion. Descriptors
   * reattach by node id: source_hash matching the new content_hash -> fresh,
   * otherwise stale; descriptor-less nodes become auto_generated.
   */
  rebuild(nodes: ReadonlyArray<NodeSpec>, parsedEdges: ReadonlyArray<EdgeSpec>, directories: ReadonlyArray<string>): void {
    for (const spec of nodes) {
      if (!spec.id || spec.id === ".") throw new GraphError(`rebuild: invalid node id '${spec.id}'`)
      if (spec.parent === spec.id) throw new GraphError(`rebuild: node ${spec.id} is its own parent`)
    }
    const seen = new Set<string>()
    for (const spec of nodes) {
      if (seen.has(spec.id)) throw new GraphError(`rebuild: duplicate node id ${spec.id}`)
      seen.add(spec.id)
    }

    // Snapshot what must survive the re-ingestion.
    const unanchoredDirs: Array<Node> = []
    const unanchoredOther: Array<Node> = []
    {
      // Depth-ordered so parents come before children on reinsert.
      const rows = this.db
        .query(
          "WITH RECURSIVE d(id, depth) AS (" +
            "  SELECT id, 0 FROM nodes WHERE parent IS NULL" +
            "  UNION ALL" +
            "  SELECT n.id, d.depth + 1 FROM nodes n JOIN d ON n.parent = d.id) " +
            `SELECT ${NODE_COLS_Q}, d.depth FROM nodes n JOIN d ON n.id = d.id ` +
            "WHERE n.anchor_file IS NULL AND n.id != '.' ORDER BY d.depth, n.ord, n.id",
        )
        .all() as RawNode[]
      for (const row of rows) {
        const node = rowToNode(row)
        if (node.kind === "directory") unanchoredDirs.push(node)
        else unanchoredOther.push(node)
      }
    }
    // Subtree locks survive re-ingestion: reapplied to nodes whose ids come back.
    const locks = (
      this.db
        .query("SELECT id, lock_owner FROM nodes WHERE lock_owner IS NOT NULL")
        .all() as Array<{ id: string; lock_owner: string }>
    ).map((row) => ({ id: row.id, owner: row.lock_owner }))
    // Directory keep set: the caller's universe, plus any directory on the
    // parent chain of a surviving skeleton (skeletons are never pruned).
    const keepDirs = new Set<string>(directories)
    {
      const dirNodes = new Map(unanchoredDirs.map((node) => [node.id, node]))
      for (const node of unanchoredOther) {
        let parent = node.parent
        while (parent && parent !== "." && !keepDirs.has(parent)) {
          const dir = dirNodes.get(parent)
          if (!dir) break
          keepDirs.add(parent)
          parent = dir.parent
        }
      }
    }
    // id -> (descriptor json, source_hash), for reattaching onto re-parsed nodes.
    interface Desc {
      json: string
      sourceHash?: string
      bindOnAnchor: boolean // descriptor written while a skeleton
    }
    const descs = new Map<string, Desc>()
    {
      const rows = this.db
        .query("SELECT id, descriptor_json, source_hash FROM nodes WHERE descriptor_json IS NOT NULL")
        .all() as Array<{ id: string; descriptor_json: string; source_hash: string | null }>
      for (const row of rows)
        descs.set(row.id, {
          json: row.descriptor_json,
          sourceHash: row.source_hash ?? undefined,
          bindOnAnchor: row.source_hash === null,
        })
    }
    const keptEdges: Array<Edge> = [] // declared / lsp / git
    {
      const rows = this.db
        .query("SELECT src, dst, type, source, confidence FROM edges WHERE source != 'parsed'")
        .all() as Array<{ src: string; dst: string; type: string; source: string; confidence: number }>
      for (const row of rows) {
        if (!EDGE_TYPES.includes(row.type as EdgeType) || !EDGE_SOURCES.includes(row.source as EdgeSource))
          throw new GraphError("corrupt store: bad edge type/source")
        keptEdges.push({
          src: row.src,
          dst: row.dst,
          type: row.type as EdgeType,
          source: row.source as EdgeSource,
          confidence: row.confidence,
        })
      }
    }

    const tx = this.db.transaction(() => {
      // Specs may reference later specs; defer FK enforcement to commit.
      this.db.run("PRAGMA defer_foreign_keys = ON")
      // Wipe everything except the root; cascades take anchored subtrees.
      this.db.run("DELETE FROM nodes WHERE id != '.'")
      const specIds = new Set(nodes.map((spec) => spec.id))

      const present = new Set<string>() // directory ids that exist again
      for (const node of unanchoredDirs) {
        if (!keepDirs.has(node.id)) continue // vanished directory: pruned
        this.insertNodeRaw(node)
        present.add(node.id)
      }
      // Create missing directories parents-first (lexicographic order puts "a/" before "a/b/").
      const newDirs = directories.filter((dir) => !present.has(dir)).toSorted()
      let nextOrd = 0
      for (const dir of newDirs) {
        const trimmed = dir.endsWith("/") ? dir.slice(0, -1) : dir
        const cut = trimmed.lastIndexOf("/")
        const parent = cut === -1 ? "." : trimmed.slice(0, cut + 1)
        if (parent !== "." && !present.has(parent))
          throw new GraphError(`rebuild: directory '${dir}' listed without its parent`)
        this.insertNodeRaw({
          id: dir,
          kind: "directory",
          parent,
          ord: nextOrd++,
          status: "skeleton",
        })
        present.add(dir)
      }
      for (const spec of nodes) {
        const node: Node = {
          id: spec.id,
          kind: spec.kind,
          parent: spec.parent || undefined,
          ord: spec.ord,
          anchor: spec.anchor,
          contentHash: spec.contentHash,
          status: "auto_generated",
        }
        const desc = descs.get(spec.id)
        if (desc) {
          node.descriptorJson = desc.json
          // First anchor binds a skeleton-written descriptor (setAnchor
          // semantics): a descriptor with no source_hash was written before any
          // body existed, so this body is the one it describes.
          if (desc.bindOnAnchor) {
            node.sourceHash = spec.contentHash
            node.status = "fresh"
          } else {
            node.sourceHash = desc.sourceHash
            node.status = desc.sourceHash === spec.contentHash ? "fresh" : "stale"
          }
        }
        this.insertNodeRaw(node)
      }
      const keptOther = new Set<string>() // skeleton files before their def children
      for (const node of unanchoredOther) {
        // A skeleton whose id the parse now anchors is materialized by the spec
        // above — keeping it too would collide on the primary key.
        if (specIds.has(node.id)) continue
        if (node.parent && (node.parent === "." || present.has(node.parent) || specIds.has(node.parent) || keptOther.has(node.parent))) {
          this.insertNodeRaw(node)
          keptOther.add(node.id)
        }
      }

      // Locks: reapply to whichever locked ids exist again.
      for (const lock of locks) {
        if (!this.exists(lock.id)) continue
        this.db.query("UPDATE nodes SET lock_owner = ?2 WHERE id = ?1").run(lock.id, lock.owner)
      }

      // Declared/lsp/git edges survive only when both endpoints exist.
      for (const edge of keptEdges) {
        if (this.exists(edge.src) && this.exists(edge.dst)) this.addEdge(edge)
      }
      for (const spec of parsedEdges) {
        if (!this.exists(spec.src) || !this.exists(spec.dst))
          throw new GraphError(`rebuild: parsed edge references missing node: ${spec.src} -> ${spec.dst}`)
        this.addEdge({ src: spec.src, dst: spec.dst, type: spec.type, source: "parsed", confidence: spec.confidence })
      }

      if (this.db.query("PRAGMA foreign_key_check").get() !== null)
        throw new GraphError("rebuild produced dangling references")
    })
    ;(tx as unknown as { immediate: () => void }).immediate()
  }
}
