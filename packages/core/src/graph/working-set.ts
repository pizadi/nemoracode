export * as Ws from "./working-set.js"

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { GraphStore, Node } from "./store.js"

/** inspect/working-set chunk cap: bodies larger than this are refused. */
export const INSPECT_BODY_CAP = 16 * 1024

export const estimateTokens = (bytes: number): number => bytes / 4

export const fmtTok = (tokens: number): string => {
  if (tokens < 1024) return String(tokens)
  // One decimal; a trailing ".0" is dropped ("3.1k", "32k").
  const whole = Math.floor(tokens / 1024)
  const tenths = Math.floor((tokens % 1024) * 10 / 1024)
  if (tenths === 0) return `${whole}k`
  return `${whole}.${tenths}k`
}

/** The node's body slice for anchored nodes; undefined when the file vanished. */
export const nodeBody = (node: Node, root: string): string | undefined => {
  if (!node.anchor) return undefined
  let bytes: string
  try {
    bytes = readFileSync(join(root, node.anchor.file), "utf8")
  } catch {
    return undefined
  }
  const start = Math.min(node.anchor.startByte, bytes.length)
  const end = Math.min(node.anchor.endByte, bytes.length)
  return bytes.slice(start, end)
}

/** Descriptor summary line ("" when absent). */
export const summaryOf = (node: Node): string => {
  if (!node.descriptorJson) return ""
  try {
    const parsed: unknown = JSON.parse(node.descriptorJson)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const summary = (parsed as Record<string, unknown>)["summary"]
      if (typeof summary === "string") return summary
    }
  } catch {
    // fallthrough
  }
  return ""
}

/** The chunk a working-set entry renders: body slice for anchored nodes, contract only for skeletons. */
const chunkFor = (node: Node, root: string): string | undefined => {
  if (!node.anchor) return node.descriptorJson ?? ""
  return nodeBody(node, root)
}

export interface WsRow {
  readonly state: "pinned" | "open" | "stub"
  readonly id: string
  readonly tokens: string // formatted, "" for stubs
  readonly takeaway: string
  readonly changed: boolean // node's store hash moved since open (human edit)
}

export interface WsSnapshot {
  readonly text: string
  readonly rows: Array<WsRow>
  readonly totalTokens: number
  readonly capTokens: number
  readonly overBudget: boolean
}

interface Entry {
  id: string
  state: "open" | "pinned" | "closed"
  takeaway: string
  lastUsed: number
  seenHash: string // node content_hash at open time ("" = unhashed)
}

/**
 * The working set: which nodes' bodies the harness renders at the end of each
 * turn. One per session. Chunk bodies are re-read from disk at every render —
 * the block is live.
 */
export class WorkingSet {
  private readonly entries: Array<Entry> = []
  private seq = 0

  constructor(readonly capTokens: number) {}

  private find(id: string): Entry | undefined {
    return this.entries.find((entry) => entry.id === id)
  }

  open(id: string, store: GraphStore.Store, root: string): string {
    let node: Node
    try {
      node = store.getNode(id)
    } catch {
      return `error: no node "${id}"`
    }
    if (node.kind === "directory") return "error: directory nodes have no body; inspect their children instead"

    const chunk = chunkFor(node, root)
    if (chunk === undefined) return `error: source file missing on disk for "${id}"`
    if (chunk.length > INSPECT_BODY_CAP)
      return `error: body of "${id}" is ${chunk.length} bytes, over the ${INSPECT_BODY_CAP}-byte working-set chunk cap; open child nodes instead`
    const tok = estimateTokens(chunk.length)

    // Admission: pins + new chunk must fit once every unpinned open chunk is
    // demotable. Otherwise the open is refused and state is unchanged.
    let pinned = 0
    for (const entry of this.entries) {
      if (entry.id === id || entry.state !== "pinned") continue
      let other: Node
      try {
        other = store.getNode(entry.id)
      } catch {
        continue // gone: renders as a stub, ~no tokens
      }
      const otherChunk = chunkFor(other, root)
      if (otherChunk !== undefined) pinned += estimateTokens(otherChunk.length)
    }
    if (pinned + tok > this.capTokens)
      return `error: working set cap ${fmtTok(this.capTokens)} tok would be exceeded and the rest is pinned; close something first`

    let entry = this.find(id)
    if (!entry) {
      entry = { id, state: "open", takeaway: "", lastUsed: 0, seenHash: "" }
      this.entries.push(entry)
    }
    entry.state = "open"
    entry.takeaway = ""
    entry.lastUsed = ++this.seq
    entry.seenHash = node.contentHash ?? ""

    // Render enforces the cap (LRU demotion) and gives exact totals for the ack.
    const snap = this.render(store, root)
    return `opened ${id} (${fmtTok(tok)} tok; ws ${fmtTok(snap.totalTokens)}/${fmtTok(this.capTokens)})`
  }

  pin(id: string, store: GraphStore.Store, root: string): string {
    const ack = this.open(id, store, root)
    if (ack.startsWith("error:")) return ack
    this.find(id)!.state = "pinned"
    return `pinned ${id} (protected from auto-demotion)`
  }

  close(id: string, takeaway: string): string {
    const note = takeaway.trim()
    if (!note) return "error: close_node requires a takeaway (one line: what you learned)"
    const entry = this.find(id)
    if (!entry || entry.state === "closed") return `error: "${id}" is not open`
    entry.state = "closed"
    entry.takeaway = note
    return `closed ${id} — stub kept`
  }

  /** Renders the L3 block and enforces the cap (LRU auto-demotion of unpinned opens past it). */
  render(store: GraphStore.Store, root: string): WsSnapshot {
    return this.project(store, root, this.entries)
  }

  /** Side-effect-free snapshot: projects cloned entries, so demotions and node-gone closures show but are discarded. */
  peek(store: GraphStore.Store, root: string): WsSnapshot {
    return this.project(store, root, this.entries.map((entry) => ({ ...entry })))
  }

  private project(store: GraphStore.Store, root: string, entries: Array<Entry>): WsSnapshot {
    interface Resolved {
      entry: Entry
      chunk: string
      tok: number
      summary: string
      changed: boolean
    }
    const live: Array<Resolved> = []
    for (const entry of entries) {
      if (entry.state === "closed") continue
      let node: Node
      try {
        node = store.getNode(entry.id)
      } catch {
        entry.state = "closed"
        entry.takeaway = "(node gone)"
        continue
      }
      let chunk = chunkFor(node, root)
      if (chunk === undefined) {
        // file vanished
        entry.state = "closed"
        entry.takeaway = "(node gone)"
        continue
      }
      if (chunk.length > INSPECT_BODY_CAP) {
        // Grew past the cap on disk: demote like the cap check would.
        if (entry.state === "open") {
          entry.state = "closed"
          entry.takeaway = "(auto-demoted: body over cap)"
          continue
        }
        chunk = "" // pinned over-cap: render without the body
      }
      live.push({
        entry,
        chunk,
        tok: estimateTokens(chunk.length),
        summary: summaryOf(node),
        changed: !!node.contentHash && entry.seenHash !== "" && node.contentHash !== entry.seenHash,
      })
    }

    // Enforce: demote LRU unpinned opens past the cap.
    let total = live.reduce((sum, r) => sum + r.tok, 0)
    while (total > this.capTokens) {
      let victim: Resolved | undefined
      for (const r of live) {
        if (r.entry.state !== "open") continue
        if (!victim || r.entry.lastUsed < victim.entry.lastUsed) victim = r
      }
      if (!victim) break
      total -= victim.tok
      victim.entry.state = "closed"
      victim.entry.takeaway = "(auto-demoted)"
      live.splice(live.indexOf(victim), 1)
    }

    // Render: pinned first, then open, then stubs (30 most recent + K more).
    const pinnedv = live.filter((r) => r.entry.state === "pinned")
    const openv = live.filter((r) => r.entry.state === "open")
    const byLru = (a: Resolved, b: Resolved) => a.entry.lastUsed - b.entry.lastUsed
    pinnedv.sort(byLru)
    openv.sort(byLru)

    const stubs: Array<Resolved> = []
    for (const entry of entries) {
      if (entry.state !== "closed") continue
      let summary = ""
      try {
        summary = summaryOf(store.getNode(entry.id))
      } catch {
        // gone: stub without summary
      }
      stubs.push({ entry, chunk: "", tok: 0, summary, changed: false })
    }
    stubs.sort((a, b) => b.entry.lastUsed - a.entry.lastUsed) // most recent first

    const rows: Array<WsRow> = []
    const text: Array<string> = []
    const overBudget = total > this.capTokens
    text.push(`## Working set  (${fmtTok(total)} / ${fmtTok(this.capTokens)} tokens)${overBudget ? "  — OVER BUDGET" : ""}`)
    if (live.length === 0) text.push("(empty)")
    const emitChunk = (r: Resolved, tag: "pinned" | "open") => {
      text.push(
        `[${tag}] ${r.entry.id}  (${fmtTok(r.tok)} tok)${r.changed ? "  [CHANGED since open — re-open]" : ""}`,
        r.chunk,
      )
      rows.push({ state: tag, id: r.entry.id, tokens: fmtTok(r.tok), takeaway: r.entry.takeaway, changed: r.changed })
    }
    for (const r of pinnedv) emitChunk(r, "pinned")
    for (const r of openv) emitChunk(r, "open")

    if (stubs.length > 0) {
      text.push("## Stubs (closed, reopenable)")
      const stubCap = 30
      for (const s of stubs.slice(0, stubCap)) {
        let line = s.entry.id
        if (s.summary) line += `  ${s.summary}`
        if (s.entry.takeaway) line += `  — ${s.entry.takeaway}`
        text.push(line)
        rows.push({ state: "stub", id: s.entry.id, tokens: "", takeaway: s.entry.takeaway, changed: false })
      }
      if (stubs.length > stubCap) text.push(`+ ${stubs.length - stubCap} more`)
    }
    return { text: `${text.join("\n")}\n`, rows, totalTokens: total, capTokens: this.capTokens, overBudget }
  }

  // --- seen-hash tracking (edit_node's stale-edit guard) ---------------------

  seenHash(id: string): string {
    return this.find(id)?.seenHash ?? ""
  }

  seenHashes(): Map<string, string> {
    const out = new Map<string, string>()
    for (const entry of this.entries)
      if (entry.state !== "closed" && entry.seenHash) out.set(entry.id, entry.seenHash)
    return out
  }

  refreshSeen(id: string, hash: string): void {
    const entry = this.find(id)
    if (entry && entry.state !== "closed") entry.seenHash = hash
  }

  /** Context rotation: drops every entry except pins. */
  resetForRotation(): void {
    for (const entry of [...this.entries]) if (entry.state !== "pinned") this.entries.splice(this.entries.indexOf(entry), 1)
  }
}
