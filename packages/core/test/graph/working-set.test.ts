import { describe, expect, test } from "bun:test"
import { GraphStore } from "../../src/graph/store.js"
import { tmpdir } from "../fixture/tmpdir.js"
import { WorkingSet, estimateTokens, fmtTok } from "../../src/graph/working-set.js"

// Real file on disk: chunk bodies are read live at every render.
const makeStore = async () => {
  const dir = await tmpdir("graph-ws-")
  const f = "x".repeat(100)
  const g = "y".repeat(100)
  await Bun.write(`${dir.path}/a.py`, f + g)
  const s = GraphStore.Store.openMemory()
  s.createNode({ id: "a.py", kind: "file", parent: ".", ord: 0, status: "skeleton" })
  s.createNode({
    id: "a.py::f",
    kind: "function",
    parent: "a.py",
    ord: 0,
    anchor: { file: "a.py", startByte: 0, endByte: 100, startLine: 1, endLine: 5 },
    contentHash: "h1",
    status: "skeleton",
  })
  s.createNode({
    id: "a.py::g",
    kind: "function",
    parent: "a.py",
    ord: 1,
    anchor: { file: "a.py", startByte: 100, endByte: 200, startLine: 6, endLine: 10 },
    contentHash: "h2",
    status: "skeleton",
  })
  return { s, dir: dir.path }
}

describe("WorkingSet", () => {
  test("fmtTok and estimateTokens", () => {
    expect(estimateTokens(400)).toBe(100)
    expect(fmtTok(832)).toBe("832")
    expect(fmtTok(31232)).toBe("30.5k")
    expect(fmtTok(32768)).toBe("32k")
  })

  test("open/close/pin lifecycle", async () => {
    const { s, dir } = await makeStore()
    const ws = new WorkingSet(4096)
    const ack = ws.open("a.py::f", s, dir)
    expect(ack).toContain("opened a.py::f")
    const snap = ws.render(s, dir)
    expect(snap.text).toContain("[open] a.py::f")
    expect(snap.text).toContain("## Working set")
    expect(snap.text).toContain("xxxx") // live body

    // Close requires a takeaway.
    expect(ws.close("a.py::f", "")).toContain("error")
    expect(ws.close("a.py::f", "learned x")).toContain("closed a.py::f — stub kept")
    const stubbed = ws.render(s, dir)
    expect(stubbed.text).toContain("## Stubs (closed, reopenable)")
    expect(stubbed.text).toContain("learned x")
    expect(stubbed.text).not.toContain("xxxx") // body gone from the block

    // Pin path.
    expect(ws.pin("a.py::g", s, dir)).toContain("pinned a.py::g")
    expect(ws.render(s, dir).text).toContain("[pinned] a.py::g")

    // Not-open nodes refuse to close.
    expect(ws.close("missing", "x")).toContain("not open")
  })

  test("directories are refused and missing nodes error", async () => {
    const { s, dir } = await makeStore()
    s.createNode({ id: "src/", kind: "directory", parent: ".", ord: 1, status: "skeleton" })
    const ws = new WorkingSet(4096)
    expect(ws.open("src/", s, dir)).toContain("directory nodes have no body")
    expect(ws.open("nope", s, dir)).toContain("no node")
  })

  test("LRU auto-demotion and pin protection", async () => {
    const { s, dir } = await makeStore()
    // Cap ~27 tokens: fits one ~25-token chunk only.
    const ws = new WorkingSet(estimateTokens(110))
    expect(ws.open("a.py::f", s, dir)).toContain("opened")
    expect(ws.open("a.py::g", s, dir)).toContain("opened")
    // f was opened first (older) → demoted when the cap forces it.
    const snap = ws.render(s, dir)
    expect(snap.text).not.toContain("[open] a.py::f") // demoted
    expect(snap.text).toContain("[open] a.py::g")
    expect(snap.text).toContain("(auto-demoted)")

    // Pinned chunks survive.
    const pinned = new WorkingSet(estimateTokens(110))
    pinned.pin("a.py::f", s, dir)
    pinned.open("a.py::g", s, dir)
    const pinnedSnap = pinned.render(s, dir)
    expect(pinnedSnap.text).toContain("[pinned] a.py::f")
    expect(pinnedSnap.text).not.toContain("[open] a.py::g") // demoted instead of the pin
  })

  test("seen hashes and rotation reset", async () => {
    const { s, dir } = await makeStore()
    const ws = new WorkingSet(4096)
    ws.open("a.py::f", s, dir)
    expect(ws.seenHash("a.py::f")).toBe("h1")
    expect(ws.seenHashes().get("a.py::f")).toBe("h1")

    // A store-side hash move (human edit + re-ingest) marks the row CHANGED.
    const node = s.getNode("a.py::f")
    s.updateNode({ ...node, contentHash: "changed" })
    expect(ws.render(s, dir).text).toContain("[CHANGED since open")

    // Rotation keeps only pins.
    ws.pin("a.py::g", s, dir)
    ws.resetForRotation()
    expect(ws.seenHash("a.py::f")).toBe("")
    expect(ws.seenHash("a.py::g")).toBe("h2")
  })

  test("over-cap body refuses to open", async () => {
    const dir = await tmpdir("graph-ws-huge-")
    await Bun.write(`${dir.path}/huge.py`, "z".repeat(90_000))
    const s = GraphStore.Store.openMemory()
    s.createNode({
      id: "huge.py",
      kind: "file",
      parent: ".",
      ord: 0,
      anchor: { file: "huge.py", startByte: 0, endByte: 90_000, startLine: 1, endLine: 10 },
      contentHash: "h",
      status: "skeleton",
    })
    const ws = new WorkingSet(4096)
    expect(ws.open("huge.py", s, dir.path)).toContain("over the 16384-byte working-set chunk cap")
  })
})
