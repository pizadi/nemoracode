import { describe, expect, test } from "bun:test"
import { GraphDescriptor } from "../../src/graph/descriptor.js"
import { GraphValidate } from "../../src/graph/validate.js"
import { GraphStore } from "../../src/graph/store.js"

describe("GraphDescriptor", () => {
  test("descriptorComplete names every offender once", () => {
    expect(GraphDescriptor.descriptorComplete(JSON.stringify({ summary: "s", purpose: "p", inputs: [], outputs: [], side_effects: [], invariants: [], uses: [] }))).toEqual({ ok: true })
    const bad = GraphDescriptor.descriptorComplete(JSON.stringify({ summary: "", inputs: [] }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.missing).toBe("summary, purpose, outputs, side_effects, invariants, uses")
    const invalid = GraphDescriptor.descriptorComplete("not json")
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.missing).toBe("(descriptor is not valid JSON)")
    const nonObject = GraphDescriptor.descriptorComplete("[1]")
    expect(nonObject.ok).toBe(false)
    if (!nonObject.ok) expect(nonObject.missing).toBe("(descriptor is not a JSON object)")
  })

  test("signatureHeader brace languages", () => {
    expect(GraphDescriptor.signatureHeader("def f(x):", "cpp")).toBe("def f(x):")
    expect(GraphDescriptor.signatureHeader("int add(int a, int b) {\n  return a + b;\n}", "cpp")).toBe("int add(int a, int b)")
    expect(GraphDescriptor.signatureHeader("  spaced_out ( x )  \n{\n}", "cpp")).toBe("spaced_out ( x )")
  })

  test("signatureHeader python waits for depth-0 colon", () => {
    expect(GraphDescriptor.signatureHeader("def f(a, b):\n    return a", "python")).toBe("def f(a, b):")
    // Multi-line signature: colon inside parens does not end the header.
    const multi = "def f(\n    a,\n    b,\n):\n    return a"
    expect(GraphDescriptor.signatureHeader(multi, "python")).toBe("def f( a, b, ):")
  })

  test("contractBearingKind", () => {
    expect(GraphDescriptor.contractBearingKind("function")).toBe(true)
    expect(GraphDescriptor.contractBearingKind("method")).toBe(true)
    expect(GraphDescriptor.contractBearingKind("class")).toBe(true)
    expect(GraphDescriptor.contractBearingKind("module")).toBe(true)
    expect(GraphDescriptor.contractBearingKind("file")).toBe(false)
    expect(GraphDescriptor.contractBearingKind("attribute")).toBe(false)
  })
})

describe("GraphValidate", () => {
  const fullDesc = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ summary: "s", purpose: "p", inputs: [], outputs: [], side_effects: [], invariants: [], uses: [], ...extra })

  const node = (id: string, kind: GraphStore.Node["kind"], parent: string, descriptorJson?: string) => {
    const store = GraphStore.Store.openMemory()
    // Create the parent chain (a file node), then the node itself.
    const file = parent.split("/")[0]
    if (parent !== ".") store.createNode({ id: parent, kind: "file", parent: ".", ord: 0, status: "skeleton" })
    void file
    store.createNode({ id, kind, parent, ord: 0, status: "skeleton", descriptorJson })
    return store
  }

  test("skeleton without descriptor on contract-bearing kinds", () => {
    const store = node("src/a.py::f", "function", "src/a.py")
    const report = GraphValidate.validateGraph(store, ".")
    expect(GraphValidate.reportOk(report)).toBe(false)
    expect(GraphValidate.reportText(report)).toContain("src/a.py::f: skeleton has no descriptor")

    // Directories (and the root) are not contract-bearing.
    const dirStore = node("lib", "directory", ".")
    expect(GraphValidate.reportOk(GraphValidate.validateGraph(dirStore, "."))).toBe(true)
  })

  test("incomplete descriptor and missing uses target", () => {
    const store = node(
      "src/a.py::f",
      "function",
      "src/a.py",
      JSON.stringify({ summary: "s", uses: ["src/missing.py::g"] }),
    )
    const report = GraphValidate.validateGraph(store, ".")
    expect(report.issues.some((issue) => issue.error && issue.msg.includes("descriptor incomplete"))).toBe(true)
    expect(report.issues.some((issue) => issue.error && issue.msg.includes('uses missing node "src/missing.py::g"'))).toBe(true)
  })

  test("inheritance self-cycle", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode({ id: "src/a.py", kind: "file", parent: ".", ord: 0, status: "skeleton" })
    store.createNode({ id: "src/a.py::A", kind: "class", parent: "src/a.py", ord: 0, status: "skeleton" })
    store.addEdge({ src: "src/a.py::A", dst: "src/a.py::A", type: "extends", source: "declared", confidence: 1 })
    const report = GraphValidate.validateGraph(store, ".")
    expect(report.issues.some((issue) => issue.msg.includes("inherits itself"))).toBe(true)
  })

  test("two-node inheritance cycle", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode({ id: "src/a.py", kind: "file", parent: ".", ord: 0, status: "skeleton" })
    store.createNode({ id: "src/a.py::A", kind: "class", parent: "src/a.py", ord: 0, status: "skeleton", descriptorJson: JSON.stringify({ summary: "a", uses: [] }) })
    store.createNode({ id: "src/b.py", kind: "file", parent: ".", ord: 1, status: "skeleton" })
    store.createNode({ id: "src/b.py::B", kind: "class", parent: "src/b.py", ord: 0, status: "skeleton", descriptorJson: JSON.stringify({ summary: "b", uses: [] }) })
    store.addEdge({ src: "src/a.py::A", dst: "src/b.py::B", type: "extends", source: "declared", confidence: 1 })
    store.addEdge({ src: "src/b.py::B", dst: "src/a.py::A", type: "extends", source: "declared", confidence: 1 })
    const report = GraphValidate.validateGraph(store, ".")
    expect(report.issues.some((issue) => issue.msg.includes("inheritance cycle"))).toBe(true)
  })

  test("file-level uses cycle is a warning, acceptance coverage errors", () => {
    const store = GraphStore.Store.openMemory()
    store.createNode({ id: "src/a.py", kind: "file", parent: ".", ord: 0, status: "skeleton", descriptorJson: fullDesc({ uses: ["src/b.py"] }) })
    store.createNode({ id: "src/b.py", kind: "file", parent: ".", ord: 1, status: "skeleton", descriptorJson: fullDesc({ uses: ["src/a.py"] }) })
    const report = GraphValidate.validateGraph(store, ".")
    expect(report.issues.some((issue) => !issue.error && issue.msg.includes("dependency cycle between files"))).toBe(true)
    expect(report.issues.some((issue) => !issue.error && issue.msg.includes("no acceptance criteria set"))).toBe(true)
    expect(GraphValidate.reportOk(report)).toBe(true) // only warnings

    store.setCriteria([{ id: "c1", text: "it works", coveredBy: ["src/missing.py"] }])
    const covered = GraphValidate.validateGraph(store, ".")
    expect(covered.issues.some((issue) => issue.error && issue.msg.includes("covers missing node"))).toBe(true)
  })
})
