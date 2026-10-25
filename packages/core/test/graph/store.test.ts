import { describe, expect, test } from "bun:test"
import { GraphStore, type Node } from "../../src/graph/store.js"
import { tmpdir } from "../fixture/tmpdir.js"

const makeNode = (id: string, parent: string, kind: Node["kind"], ord = 0): Node => ({
  id,
  kind,
  parent: parent || undefined,
  ord,
  status: "skeleton",
})

const makeAnchored = (id: string, parent: string, kind: Node["kind"], hash: string, ord = 0): Node => ({
  ...makeNode(id, parent, kind, ord),
  anchor: { file: "src/a.py", startByte: 0, endByte: 100, startLine: 1, endLine: 10 },
  contentHash: hash,
  status: "auto_generated",
})

const desc = (summary: string) =>
  JSON.stringify({ summary, purpose: "why", inputs: [], outputs: [] })

describe("GraphStore", () => {
  // --- schema, CRUD, constraints ------------------------------------------
  test("crud and constraints", () => {
    const store = GraphStore.Store.openMemory()
    const root = store.getNode(".")
    expect(root.kind).toBe("directory")
    expect(root.parent).toBeUndefined()

    store.createNode(makeNode("src", ".", "directory", 1))
    store.createNode(makeAnchored("src/a.py", "src", "file", "hash1", 2))
    store.createNode({ ...makeAnchored("src/a.py::f", "src/a.py", "function", "hashf"), anchor: { file: "src/a.py", startByte: 10, endByte: 50, startLine: 2, endLine: 9 } })

    const got = store.getNode("src/a.py::f")
    expect(got.kind).toBe("function")
    expect(got.parent).toBe("src/a.py")
    expect(got.anchor).toEqual({ file: "src/a.py", startByte: 10, endByte: 50, startLine: 2, endLine: 9 })
    expect(got.contentHash).toBe("hashf")
    expect(got.status).toBe("auto_generated")

    expect(() => store.createNode(makeNode("src", ".", "directory", 1))).toThrow() // duplicate
    expect(() => store.createNode(makeNode("x", "nope", "class"))).toThrow()
    expect(() => store.getNode("missing")).toThrow()
    expect(() => store.updateNode(makeNode("missing", "", "class"))).toThrow()
    expect(() => store.createNode({ ...makeAnchored("src/a.py::g", "src/a.py", "function", "h"), descriptorJson: "not json" })).toThrow()
    expect(() => store.createNode({ ...makeAnchored("src/a.py::g", "src/a.py", "function", "h"), descriptorJson: "[1,2]" })).toThrow()

    // updateNode round trip.
    store.updateNode({ ...got, status: "needs_review", lockOwner: "task-1" })
    const reread = store.getNode("src/a.py::f")
    expect(reread.status).toBe("needs_review")
    expect(reread.lockOwner).toBe("task-1")

    store.unlockAll("task-1")
    expect(store.getNode("src/a.py::f").lockOwner).toBeUndefined()
  })

  // --- persistence across reopen (file store) ------------------------------
  test("persists across reopen", async () => {
    await using tmp = await tmpdir()
    const path = `${tmp.path}/graph.db`
    {
      const store = GraphStore.Store.open(path)
      store.createNode(makeNode("src", ".", "directory", 1))
      store.createNode(makeAnchored("src/a.py", "src", "file", "h"))
      store.setDescriptor("src/a.py", desc("persisted file"))
      store.close()
    }
    {
      const store = GraphStore.Store.open(path)
      expect(store.getNode("src/a.py").contentHash).toBe("h")
      expect(store.getNode("src/a.py").status).toBe("fresh")
      expect(store.searchDescriptors("persisted")).not.toHaveLength(0)
      store.close()
    }
  })

  // --- tree ops, subtree delete ---------------------------------------------
  test("tree ops and subtree delete", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src", ".", "directory", 1))
    store.createNode(makeNode("lib", ".", "directory", 2))
    store.createNode(makeAnchored("src/a.py", "src", "file", "h1", 1))
    store.createNode(makeAnchored("src/b.py", "src", "file", "h2", 2))
    store.createNode(makeAnchored("src/a.py::f", "src/a.py", "function", "h3"))
    store.setDescriptor("src/a.py::f", desc("delete me"))

    expect(store.children(".").map((c) => c.id)).toEqual(["src", "lib"])
    const subtree = store.subtree(".")
    expect(subtree).toHaveLength(6) // ., src, lib, a.py, b.py, a.py::f
    expect(subtree[0]?.id).toBe(".")

    expect(store.ancestors("src/a.py::f").map((n) => n.id)).toEqual(["src/a.py", "src", "."])

    store.addEdge({ src: "src/a.py::f", dst: "lib", type: "uses", source: "declared", confidence: 1.0 })
    store.deleteSubtree("src")
    expect(() => store.getNode("src/a.py::f")).toThrow()
    expect(() => store.getNode("src")).toThrow()
    expect(store.getNode("lib").id).toBe("lib")
    expect(store.edgesTo("lib")).toEqual([]) // edge died with its source
    expect(store.searchDescriptors("delete me")).toEqual([])
  })

  // --- FTS ranking and sanitization ------------------------------------------
  test("fts ranking and sanitization", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src/invoice.py", ".", "file", 1))
    store.createNode(makeNode("src/util.py", ".", "file", 2))
    store.createNode(makeNode("src/reader.py", ".", "file", 3))
    store.setDescriptor("src/invoice.py", desc("billing invoice totals"))
    store.setDescriptor("src/util.py", desc("string helpers for parsing utility text"))
    store.setDescriptor("src/reader.py", desc("reads config files"))

    const hits = store.searchDescriptors("invoice", 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe("src/invoice.py")

    // Identifier search hits the id column.
    const byId = store.searchDescriptors("invoice.py", 10)
    expect(byId).toHaveLength(1)
    expect(byId[0]?.id).toBe("src/invoice.py")

    // Two terms AND together.
    expect(store.searchDescriptors("invoice totals", 10)).toHaveLength(1)
    expect(store.searchDescriptors("invoice config", 10)).toHaveLength(0)

    // Hostile / degenerate queries never throw.
    expect(store.searchDescriptors("\"*() OR 1=1 --", 10)).toHaveLength(0)
    expect(store.searchDescriptors("   ", 10)).toHaveLength(0)
    expect(store.searchDescriptors("!!!", 10)).toHaveLength(0)
    expect(store.searchDescriptors("AND OR NOT NEAR", 10)).toHaveLength(0)
    expect(store.searchDescriptors("invoice", 0)).toHaveLength(0)
  })

  // --- descriptor lifecycle --------------------------------------------------
  test("descriptor lifecycle", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src/m.py", ".", "file", 1)) // skeleton file
    // Skeleton file with a descriptor: setAnchor later flips it to fresh.
    store.setDescriptor("src/m.py", desc("module contract"))
    expect(store.getNode("src/m.py").status).toBe("skeleton")
    expect(store.getNode("src/m.py").sourceHash).toBeUndefined()

    store.setAnchor("src/m.py", { file: "src/m.py", startByte: 0, endByte: 42, startLine: 1, endLine: 5 }, "hashA")
    const node = store.getNode("src/m.py")
    expect(node.status).toBe("fresh")
    expect(node.sourceHash).toBe("hashA")
    expect(store.searchDescriptors("module contract")).toHaveLength(1)

    // Descriptor update rewrites the FTS row.
    store.setDescriptor("src/m.py", desc("renamed contract"))
    expect(store.searchDescriptors("module contract")).toHaveLength(0)
    expect(store.searchDescriptors("renamed contract")).toHaveLength(1)
  })

  // --- locks -------------------------------------------------------------------
  test("locks", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src", ".", "directory", 1))
    store.createNode(makeAnchored("src/a.py", "src", "file", "h1", 1))
    store.createNode(makeAnchored("src/b.py", "src", "file", "h2", 2))
    store.createNode(makeAnchored("src/a.py::f", "src/a.py", "function", "h3"))

    store.tryLock("src", "t1")
    expect(store.lockHolder("src/a.py::f")).toBe("t1")
    expect(store.lockHolder("src")).toBe("t1")
    expect(() => store.tryLock("src/a.py", "t2")).toThrow() // ancestor held
    expect(() => store.tryLock(".", "t2")).toThrow() // descendant of src
    expect(() => store.tryLock("src/b.py", "t2")).toThrow() // descendant of src

    store.unlock("src", "t1")
    expect(store.lockHolder("src/a.py")).toBeUndefined()

    // Siblings lock independently.
    store.tryLock("src/a.py", "t1")
    store.tryLock("src/b.py", "t2")
    expect(() => store.tryLock("src", "t3")).toThrow()
    expect(store.lockHolder("src/a.py::f")).toBe("t1")
    expect(store.lockHolder("src/b.py")).toBe("t2")

    // Same owner re-lock is idempotent.
    store.tryLock("src/a.py", "t1")

    store.unlockAll("t1")
    expect(store.lockHolder("src/a.py::f")).toBeUndefined()
    expect(store.lockHolder("src/b.py")).toBe("t2")

    expect(() => store.tryLock("missing", "t1")).toThrow()
  })

  // --- rebuild round-trip --------------------------------------------------------
  test("rebuild round trip", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src", ".", "directory", 1))
    // Old ingestion: a.py (same hash) + old.py (vanishes) + f (hash changes).
    store.createNode(makeAnchored("src/a.py", "src", "file", "hashA", 1))
    store.createNode(makeAnchored("src/old.py", "src", "file", "hashOld", 2))
    store.createNode(makeAnchored("src/old.py::gone", "src/old.py", "function", "h"))
    const fnNode = makeAnchored("src/a.py::f", "src/a.py", "function", "hash1", 1)
    store.createNode(fnNode)
    store.setDescriptor("src/a.py::f", desc("f contract"))
    expect(store.getNode("src/a.py::f").status).toBe("fresh")
    // A skeleton designed but not yet written.
    store.createNode(makeNode("src/newmod.py", "src", "file", 3))
    store.setDescriptor("src/newmod.py", desc("future module"))
    // Declared edges: one surviving (skeleton -> f), one to a vanished node.
    store.addEdge({ src: "src/newmod.py", dst: "src/a.py::f", type: "uses", source: "declared", confidence: 1.0 })
    store.addEdge({ src: "src/newmod.py", dst: "src/old.py::gone", type: "calls", source: "declared", confidence: 1.0 })

    const specs: Array<GraphStore.NodeSpec> = [
      {
        id: "src/a.py",
        parent: "src",
        kind: "file",
        anchor: { file: "src/a.py", startByte: 0, endByte: 100, startLine: 1, endLine: 10 },
        contentHash: "hashA",
        ord: 0,
      },
      {
        id: "src/a.py::f",
        parent: "src/a.py",
        kind: "function",
        anchor: { file: "src/a.py", startByte: 10, endByte: 50, startLine: 2, endLine: 9 },
        contentHash: "hash2", // descriptor written against hash1 -> stale
        ord: 0,
      },
      {
        id: "src/a.py::g",
        parent: "src/a.py",
        kind: "function",
        anchor: { file: "src/a.py", startByte: 50, endByte: 90, startLine: 5, endLine: 9 },
        contentHash: "hash3",
        ord: 1,
      },
    ]
    store.rebuild(specs, [{ src: "src/a.py::f", dst: "src/a.py::g", type: "calls", confidence: 0.9 }], ["src"])

    // Re-parsed nodes exist with fresh/stale/auto_generated statuses.
    expect(store.getNode("src/a.py").status).toBe("auto_generated")
    const fNode = store.getNode("src/a.py::f")
    expect(fNode.status).toBe("stale")
    expect(fNode.descriptorJson).toBeDefined()
    expect(fNode.sourceHash).toBe("hash1") // written against old source
    expect(store.getNode("src/a.py::g").status).toBe("auto_generated")
    expect(() => store.getNode("src/old.py")).toThrow()

    // Skeleton + its descriptor and declared edge survived; vanished target dropped.
    const skel = store.getNode("src/newmod.py")
    expect(skel.status).toBe("skeleton")
    expect(skel.descriptorJson).toBeDefined()
    expect(store.getNode("src").kind).toBe("directory")
    const kept = store.edgesFrom("src/newmod.py")
    expect(kept).toHaveLength(1)
    expect(kept[0]?.dst).toBe("src/a.py::f")
    expect(kept[0]?.source).toBe("declared")

    // Parsed edge inserted exactly once.
    const parsed = store.edgesFrom("src/a.py::f", ["calls"])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.source).toBe("parsed")
    expect(parsed[0]?.dst).toBe("src/a.py::g")

    // Descriptor reattachment keeps FTS in sync.
    expect(store.searchDescriptors("f contract")).toHaveLength(1)

    // Idempotent: a second identical rebuild changes nothing observable.
    store.rebuild(specs, [{ src: "src/a.py::f", dst: "src/a.py::g", type: "calls", confidence: 0.9 }], ["src"])
    expect(store.getNode("src/a.py::f")).toEqual(fNode)
    expect(store.edgesFrom("src/a.py::f", ["calls"])).toHaveLength(1)
    expect(store.edgesFrom("src/newmod.py")).toHaveLength(1)
    expect(store.subtree(".")).toHaveLength(6) // . src a.py f g newmod.py

    // Parsed edge with a missing endpoint is refused.
    expect(() => store.rebuild(specs, [{ src: "src/a.py::f", dst: "src/nowhere", type: "calls", confidence: 1.0 }], ["src"])).toThrow()
  })

  // --- vanished directory pruning ------------------------------------------------
  test("vanished directory pruning", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeNode("src", ".", "directory", 1))
    store.createNode(makeNode("gone", ".", "directory", 2))
    // A skeleton in a directory that vanished from disk: dir chain is kept.
    store.createNode(makeNode("gone/skel.py", "gone", "file", 1))
    store.createNode(makeNode("empty", ".", "directory", 3)) // vanished, nothing inside
    const specs: Array<GraphStore.NodeSpec> = [
      {
        id: "src/a.py",
        parent: "src",
        kind: "file",
        anchor: { file: "src/a.py", startByte: 0, endByte: 3, startLine: 1, endLine: 1 },
        contentHash: "h",
        ord: 0,
      },
    ]
    store.rebuild(specs, [], ["src", "fresh"])

    expect(() => store.getNode("empty")).toThrow() // pruned
    expect(store.getNode("gone").kind).toBe("directory") // kept: skeleton needs it
    expect(store.getNode("gone/skel.py").status).toBe("skeleton")
    expect(store.getNode("fresh").kind).toBe("directory") // created
    expect(store.getNode("src").kind).toBe("directory")
    expect(store.getNode("src/a.py").status).toBe("auto_generated")
  })

  // --- task ledger -----------------------------------------------------------------
  test("task ledger, journal, scratch", () => {
    const store = GraphStore.Store.openMemory()
    expect(store.getActiveTask()).toBeUndefined()

    const id1 = store.createTask(JSON.stringify({ goal: "one" }))
    const id2 = store.createTask(JSON.stringify({ goal: "two" }))
    expect(id1).toBe("T1")
    expect(id2).toBe("T2")
    expect(store.getActiveTask()?.id).toBe("T2") // most recent

    const sub = store.createTask("{}", id2)
    expect(sub).toBe("T3")
    expect(store.getActiveTask()?.id).toBe("T2") // subs are not top-level

    store.appendJournal(id2, 1, "started work")
    store.appendJournal(id2, 1, "made a decision")
    expect(store.getJournal(id2).map((entry) => entry.text)).toEqual(["started work", "made a decision"])
    expect(store.getJournal(id2)[0]?.seq).toBe(1)
    expect(store.getJournal(id2)[1]?.seq).toBe(2)
    expect(store.getJournal(id1)).toEqual([])

    store.appendScratch(id2, 1, "src/a.py::f", "it does X")
    expect(store.getScratch(id2)).toEqual([{ seq: 1, era: 1, node: "src/a.py::f", takeaway: "it does X" }])

    expect(store.bumpEra(id2)).toBe(2)
    expect(store.getTask(id2)?.era).toBe(2)

    store.closeTask(id2, "done", JSON.stringify({ result: "ok" }))
    expect(store.getActiveTask()?.id).toBe("T1")
    expect(store.getTask(id2)?.status).toBe("done")
    expect(store.getTask(id2)?.closedAt).toBeDefined()

    const abandoned = store.abandonActiveSubTasks()
    expect(abandoned).toBe(1)
    expect(store.getTask(sub)?.status).toBe("abandoned")
  })

  test("criteria and meta", () => {
    const store = GraphStore.Store.openMemory()
    expect(store.getCriteria()).toEqual([])
    store.setCriteria([
      { id: "c1", text: "it works", coveredBy: ["src/a.py::f"] },
      { id: "c2", text: "it is fast", coveredBy: [] },
    ])
    expect(store.getCriteria()).toEqual([
      { id: "c1", text: "it works", coveredBy: ["src/a.py::f"] },
      { id: "c2", text: "it is fast", coveredBy: [] },
    ])
    store.setCriteria([{ id: "c3", text: "replaced", coveredBy: [] }])
    expect(store.getCriteria()).toEqual([{ id: "c3", text: "replaced", coveredBy: [] }])
    expect(() => store.setCriteria([{ id: "", text: "x", coveredBy: [] }])).toThrow()

    expect(store.getMeta("stage")).toBeUndefined()
    store.setMeta("stage", "skeleton")
    expect(store.getMeta("stage")).toBe("skeleton")
    store.setMeta("stage", "fill")
    expect(store.getMeta("stage")).toBe("fill")
  })

  test("edge validation", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode(makeAnchored("src/a.py", ".", "file", "h1", 1))
    store.createNode(makeAnchored("src/b.py", ".", "file", "h2", 2))
    expect(() => store.addEdge({ src: "src/a.py", dst: "missing", type: "calls", source: "declared", confidence: 1 })).toThrow()
    expect(() => store.addEdge({ src: "missing", dst: "src/a.py", type: "calls", source: "declared", confidence: 1 })).toThrow()
    expect(() => store.addEdge({ src: "src/a.py", dst: "src/b.py", type: "calls", source: "declared", confidence: 1.5 })).toThrow()
    store.addEdge({ src: "src/a.py", dst: "src/b.py", type: "calls", source: "declared", confidence: 1 })
    store.addEdge({ src: "src/a.py", dst: "src/b.py", type: "calls", source: "declared", confidence: 0.5 }) // upsert
    expect(store.edgesFrom("src/a.py")).toEqual([{ src: "src/a.py", dst: "src/b.py", type: "calls", source: "declared", confidence: 0.5 }])
    store.removeEdge("src/a.py", "src/b.py", "calls", "declared")
    expect(store.edgesFrom("src/a.py")).toEqual([])
  })
})
