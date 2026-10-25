export * as GraphValidate from "./validate.js"

import { GraphDescriptor } from "./descriptor.js"
import { GraphError, type Node, type Store } from "./store.js"

export interface Issue {
  readonly error: boolean
  readonly msg: string
}

export interface ValidationReport {
  readonly issues: Array<Issue>
}

export const reportOk = (report: ValidationReport): boolean => report.issues.every((issue) => !issue.error)

export const reportText = (report: ValidationReport): string => {
  let errors = 0
  let warnings = 0
  for (const issue of report.issues) issue.error ? errors++ : warnings++
  if (errors === 0 && warnings === 0) return "validation passed (no errors, no warnings)"
  let out = `validation: ${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}\n`
  for (const issue of report.issues) out += `${issue.error ? "error" : "warning"}: ${issue.msg}\n`
  return out
}

// Tarjan SCC over an adjacency map (missing keys = no outgoing edges).
const sccs = (graph: Map<string, Array<string>>): Array<Array<string>> => {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const out: Array<Array<string>> = []
  let counter = 0

  const dfs = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter++
    stack.push(v)
    onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        dfs(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!))
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: Array<string> = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      out.push(comp)
    }
  }
  for (const v of graph.keys()) if (!index.has(v)) dfs(v)
  return out.map((comp) => comp.toSorted())
}

const exists = (store: Store, id: string): boolean => {
  try {
    store.getNode(id)
    return true
  } catch (error) {
    if (error instanceof GraphError) return false
    throw error
  }
}

/** The node's containing file (itself when kind == file), undefined for directories / the root. */
const fileOf = (store: Store, id: string): string | undefined => {
  let node: Node
  try {
    node = store.getNode(id)
  } catch (error) {
    if (error instanceof GraphError) return undefined
    throw error
  }
  if (node.kind === "file") return node.id
  for (const ancestor of store.ancestors(id)) if (ancestor.kind === "file") return ancestor.id
  return undefined
}

const descriptorUses = (node: Node): Array<string> => {
  if (!node.descriptorJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(node.descriptorJson)
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null) return []
  const uses = (parsed as Record<string, unknown>)["uses"]
  if (!Array.isArray(uses)) return []
  return uses.filter((item): item is string => typeof item === "string")
}

export const validateGraph = (store: Store, root: string): ValidationReport => {
  const report: ValidationReport = { issues: [] }
  const scope = store.subtree(root) // throws on missing root
  const ids = new Set(scope.map((node) => node.id))

  // 1+2: descriptor presence/completeness + declared deps resolve.
  for (const node of scope) {
    if (!node.descriptorJson) {
      if (node.status === "skeleton" && (GraphDescriptor.contractBearingKind(node.kind) || node.kind === "file"))
        report.issues.push({ error: true, msg: `${node.id}: skeleton has no descriptor` })
      continue
    }
    const complete = GraphDescriptor.descriptorComplete(node.descriptorJson)
    if (!complete.ok)
      report.issues.push({ error: true, msg: `${node.id}: descriptor incomplete — missing/empty fields: ${complete.missing}` })
    for (const dst of descriptorUses(node)) {
      if (!ids.has(dst) && !exists(store, dst))
        report.issues.push({ error: true, msg: `${node.id}: uses missing node "${dst}"` })
    }
  }

  // 3a: node-level inheritance cycles (extends/implements, any source).
  const inherits = new Map<string, Array<string>>()
  const inheritEdges: Array<readonly [string, string]> = []
  for (const node of scope) {
    for (const edge of store.edgesFrom(node.id, ["extends", "implements"])) {
      if (!ids.has(edge.dst) && !exists(store, edge.dst)) continue
      inherits.set(edge.src, [...(inherits.get(edge.src) ?? []), edge.dst])
      inheritEdges.push([edge.src, edge.dst])
    }
  }
  for (const [src, dst] of inheritEdges) {
    if (src === dst) report.issues.push({ error: true, msg: `${src}: inherits itself` })
  }
  for (const comp of sccs(inherits)) {
    if (comp.length < 2) continue
    report.issues.push({ error: true, msg: `inheritance cycle (extends/implements): ${comp.join(", ")}` })
  }

  // 3b: file-level uses cycles — warnings (legal in some languages; the agent
  // decides). Roll each uses edge up to the containing files.
  const fileDeps = new Map<string, Array<string>>()
  const fileEdges = new Set<string>()
  for (const node of scope) {
    const srcFile = fileOf(store, node.id)
    if (!srcFile) continue
    for (const use of descriptorUses(node)) {
      const dstFile = fileOf(store, use)
      if (!dstFile || dstFile === srcFile) continue
      const key = `${srcFile}\u0000${dstFile}`
      if (!fileEdges.has(key)) {
        fileEdges.add(key)
        fileDeps.set(srcFile, [...(fileDeps.get(srcFile) ?? []), dstFile])
      }
    }
  }
  for (const comp of sccs(fileDeps)) {
    if (comp.length < 2) continue
    report.issues.push({ error: false, msg: `dependency cycle between files: ${comp.join(", ")}` })
  }

  // 4: acceptance coverage.
  const criteria = store.getCriteria()
  if (criteria.length === 0) {
    report.issues.push({ error: false, msg: "no acceptance criteria set (set_acceptance)" })
  } else {
    for (const criterion of criteria) {
      if (criterion.coveredBy.length === 0) {
        report.issues.push({ error: true, msg: `criterion "${criterion.id}" is not covered by any node` })
        continue
      }
      for (const id of criterion.coveredBy) {
        if (!exists(store, id))
          report.issues.push({ error: true, msg: `criterion "${criterion.id}" covers missing node "${id}"` })
      }
    }
  }
  return report
}
