import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/tmpdir.js"
import { GraphHash } from "../../src/graph/hash.js"
import { GraphIngest } from "../../src/graph/ingest.js"
import { GraphStore } from "../../src/graph/store.js"

const FIXTURE_ROOT = path.join(import.meta.dir, "fixture")
const ALL_LANGS = ["c", "cpp", "python", "typescript", "rust"]

// Copies every fixture file of `name` into a fresh temp dir.
const ingestFixture = async (name: string, langs: ReadonlyArray<string> = ALL_LANGS) => {
  const dir = await tmpdir(`graph-ingest-${name}-`)
  for (const file of [...new Bun.Glob("*").scanSync({ cwd: path.join(FIXTURE_ROOT, name), onlyFiles: true })])
    await Bun.write(`${dir.path}/${file}`, readFileSync(path.join(FIXTURE_ROOT, name, file)))
  const store = GraphStore.Store.openMemory()
  const stats = await GraphIngest.ingest(store, dir.path, langs)
  return { store, stats, dir }
}

describe("GraphIngest", () => {
  test("python: nesting, methods, duplicate ids, calls, unresolved imports", async () => {
    const { store, stats, dir } = await ingestFixture("py")
    expect(stats.files).toBe(1)
    expect(stats.fileNodes).toBe(1)
    expect(stats.defNodes).toBe(4)
    expect(stats.dirNodes).toBe(0)
    expect(stats.callEdges).toBe(2)
    expect(stats.unresolvedImports).toBe(2)
    expect(stats.droppedRefs).toBe(1) // os.path.len

    const src = readFileSync(`${dir.path}/app.py`, "utf8")
    const f = store.getNode("app.py")
    expect(f.kind).toBe("file")
    expect(f.parent).toBe(".")
    expect(f.anchor).toBeDefined()
    expect(f.contentHash).toBe(GraphHash.hashText(src))

    const inv = store.getNode("app.py::Invoice")
    expect(inv.kind).toBe("class")
    expect(inv.parent).toBe("app.py")
    expect(inv.anchor?.startLine).toBe(6)
    expect(inv.status).toBe("auto_generated")

    const total = store.getNode("app.py::Invoice.total")
    expect(total.kind).toBe("method")
    expect(total.parent).toBe("app.py::Invoice")
    expect(total.anchor?.startLine).toBe(9)

    const c1 = store.getNode("app.py::compute")
    expect(c1.kind).toBe("function")
    expect(c1.anchor?.startLine).toBe(13)
    const c2 = store.getNode("app.py::compute#2")
    expect(c2.kind).toBe("function")
    expect(c2.anchor?.startLine).toBe(17)

    // Overloaded callee: two candidates, one edge each at 1/2 confidence.
    const calls = store.edgesFrom("app.py::Invoice.total", ["calls"])
    expect(calls).toHaveLength(2)
    const dsts = new Set(calls.map((edge) => edge.dst))
    for (const edge of calls) {
      expect(edge.source).toBe("parsed")
      expect(edge.confidence).toBe(0.5)
    }
    expect(dsts.has("app.py::compute")).toBe(true)
    expect(dsts.has("app.py::compute#2")).toBe(true)
    expect(store.edgesFrom("app.py", ["imports"])).toEqual([])

    // Anchored bytes hash back to the stored content hash.
    for (const node of store.subtree(".")) {
      if (!node.anchor) continue
      if (!node.contentHash) continue
      expect(GraphHash.hashText(src.slice(node.anchor.startByte, node.anchor.endByte))).toBe(node.contentHash)
    }
  })

  test("c++ / c: modules, includes, extends", async () => {
    const { store, stats } = await ingestFixture("cpp")
    expect(stats.files).toBe(2)

    expect(store.getNode("geom.h::geo").kind).toBe("module")
    const shape = store.getNode("geom.h::geo.Shape")
    expect(shape.kind).toBe("class")
    expect(shape.parent).toBe("geom.h::geo")
    const area = store.getNode("geom.h::geo.Shape.area")
    expect(area.kind).toBe("method")
    expect(area.anchor?.startLine).toBe(4)
    expect(store.getNode("geom.h::geo.Square").kind).toBe("class")

    const fn = store.getNode("geom.cpp::geo.Area")
    expect(fn.kind).toBe("function")
    expect(fn.parent).toBe("geom.cpp::geo")
    expect(fn.anchor?.startLine).toBe(3)

    // #include "geom.h" resolves through the file's own directory.
    const inc = store.edgesFrom("geom.cpp", ["imports"])
    expect(inc).toHaveLength(1)
    expect(inc[0]?.dst).toBe("geom.h")

    // struct Square : Shape
    const ext = store.edgesFrom("geom.h::geo.Square", ["extends"])
    expect(ext).toHaveLength(1)
    expect(ext[0]?.dst).toBe("geom.h::geo.Shape")
    expect(ext[0]?.confidence).toBe(1.0)

    // s.area() resolves through the include graph; Shape.area + Square.area.
    const calls = store.edgesFrom("geom.cpp::geo.Area", ["calls"])
    expect(calls).toHaveLength(2)
  })

  test("typescript: interfaces, implements, imports, calls", async () => {
    const { store } = await ingestFixture("ts")
    expect(store.getNode("app.ts::Friend").kind).toBe("class")
    expect(store.getNode("app.ts::Friend.greet").kind).toBe("method")
    expect(store.getNode("app.ts::Greeter").kind).toBe("class")
    expect(store.getNode("app.ts::Greeter.greet").kind).toBe("method")
    expect(store.getNode("util.ts::helper").kind).toBe("function")

    const impl = store.edgesFrom("app.ts::Greeter", ["implements"])
    expect(impl).toHaveLength(1)
    expect(impl[0]?.dst).toBe("app.ts::Friend")

    const inc = store.edgesFrom("app.ts", ["imports"])
    expect(inc).toHaveLength(1)
    expect(inc[0]?.dst).toBe("util.ts")

    // helper(this) resolves through the import to util.ts::helper.
    const calls = store.edgesFrom("app.ts::Greeter.greet", ["calls"])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.dst).toBe("util.ts::helper")
    expect(calls[0]?.confidence).toBe(1.0)
  })

  test("rust: traits, impl prefixing, implements, mod imports", async () => {
    const { store, stats } = await ingestFixture("rust")
    const trait = store.getNode("app.rs::Shape")
    expect(trait.kind).toBe("class")
    const traitFn = store.getNode("app.rs::Shape.area")
    expect(traitFn.kind).toBe("method")
    expect(traitFn.parent).toBe("app.rs::Shape")

    expect(store.getNode("app.rs::Square").kind).toBe("class")
    // Method inside `impl Shape for Square`: prefixed by the subject type,
    // no node for the impl block itself.
    const implFn = store.getNode("app.rs::Square.area")
    expect(implFn.kind).toBe("function")
    expect(implFn.parent).toBe("app.rs")
    expect(implFn.anchor?.startLine).toBe(10)

    const impl = store.edgesFrom("app.rs::Square", ["implements"])
    expect(impl).toHaveLength(1)
    expect(impl[0]?.dst).toBe("app.rs::Shape")
    expect(stats.unresolvedImports).toBe(1) // mod util -> util.rs missing
  })

  test("c / headers", async () => {
    const { store, stats } = await ingestFixture("c")
    expect(stats.files).toBe(2)
    expect(store.getNode("point.h::Point").kind).toBe("class")
    const dist = store.getNode("util.c::dist")
    expect(dist.kind).toBe("function")
    expect(dist.anchor?.startLine).toBe(3)
    const inc = store.edgesFrom("util.c", ["imports"])
    expect(inc).toHaveLength(1)
    expect(inc[0]?.dst).toBe("point.h")
    expect(stats.callEdges).toBe(0) // p.x is no call
  })

  test("fallback regions", async () => {
    const { store, stats } = await ingestFixture("fallback")
    expect(stats.files).toBe(1)
    expect(stats.regionNodes).toBe(3)
    expect(stats.defNodes).toBe(0) // regions are counted separately
    expect(stats.callEdges).toBe(0)

    const r1 = store.getNode("notes.md::region#1")
    expect(r1.kind).toBe("region")
    expect(r1.parent).toBe("notes.md")
    expect(r1.anchor?.startLine).toBe(1)
    expect(store.getNode("notes.md::region#2").anchor?.startLine).toBe(6)
    expect(store.getNode("notes.md::region#3").anchor?.startLine).toBe(10)
  })

  test("descriptor retention across re-ingest", async () => {
    const dir = await tmpdir("graph-ingest-retention-")
    for (const file of [...new Bun.Glob("*").scanSync({ cwd: path.join(FIXTURE_ROOT, "py"), onlyFiles: true })])
      await Bun.write(`${dir.path}/${file}`, readFileSync(path.join(FIXTURE_ROOT, "py", file)))

    const store = GraphStore.Store.openMemory()
    await GraphIngest.ingest(store, dir.path, ALL_LANGS)
    store.setDescriptor("app.py::compute", JSON.stringify({ summary: "one" }))
    store.setDescriptor("app.py::compute#2", JSON.stringify({ summary: "two" }))
    expect(store.getNode("app.py::compute").status).toBe("fresh")
    expect(store.getNode("app.py::compute#2").status).toBe("fresh")

    await GraphIngest.ingest(store, dir.path, ALL_LANGS) // same bytes -> still fresh
    expect(store.getNode("app.py::compute").status).toBe("fresh")

    // Edit compute#2's body -> its hash changes -> stale; compute stays fresh.
    const src = readFileSync(`${dir.path}/app.py`, "utf8")
    await Bun.write(`${dir.path}/app.py`, src.replace("return q + r", "return q - r"))
    await GraphIngest.ingest(store, dir.path, ALL_LANGS)
    expect(store.getNode("app.py::compute").status).toBe("fresh")
    expect(store.getNode("app.py::compute#2").status).toBe("stale")
  })

  test("self-ingest of packages/util", async () => {
    // A real TS tree: every anchored node's byte slice re-hashes to its content hash.
    const root = "/home/parham/projs/nemoracode/packages/util"
    const store = GraphStore.Store.openMemory()
    const stats = await GraphIngest.ingest(store, root, ["typescript"])
    expect(stats.files).toBeGreaterThan(5)
    expect(stats.dirNodes).toBeGreaterThan(0)
    for (const node of store.subtree(".")) {
      if (!node.anchor || !node.contentHash) continue
      const src = readFileSync(`${root}/${node.anchor.file}`, "utf8")
      expect(node.anchor.endByte).toBeLessThanOrEqual(src.length)
      expect(GraphHash.hashText(src.slice(node.anchor.startByte, node.anchor.endByte))).toBe(node.contentHash)
    }
  })
})
