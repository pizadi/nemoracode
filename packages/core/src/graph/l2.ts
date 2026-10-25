export * as TaskState from "./l2.js"

import { GraphStore } from "./store.js"

// Parsed view of a task definition (all fields optional but goal).
interface Def {
  goal: string
  rootNodes: Array<string>
  behavioralChange: string
  constraints: string
  budget: string
  returnFormat: string
  dependencyContracts: string
}

const parseDef = (definitionJson: string): Def => {
  const def: Def = {
    goal: "",
    rootNodes: [],
    behavioralChange: "",
    constraints: "",
    budget: "",
    returnFormat: "",
    dependencyContracts: "",
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(definitionJson)
  } catch {
    return def
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return def
  const j = parsed as Record<string, unknown>
  if (typeof j["goal"] === "string") def.goal = j["goal"]
  if (Array.isArray(j["root_nodes"]))
    def.rootNodes = j["root_nodes"].filter((item): item is string => typeof item === "string")
  if (typeof j["behavioral_change"] === "string") def.behavioralChange = j["behavioral_change"]
  if (typeof j["constraints"] === "string") def.constraints = j["constraints"]
  if (typeof j["return_format"] === "string") def.returnFormat = j["return_format"]
  if (typeof j["dependency_contracts"] === "string") def.dependencyContracts = j["dependency_contracts"]
  if (typeof j["budget"] === "object" && j["budget"] !== null) def.budget = JSON.stringify(j["budget"])
  return def
}

const joinList = (values: ReadonlyArray<string>): string => values.join(", ")

/** The L2 block: task definition, acceptance criteria, journal and scratchpad. "" when no task. */
export const renderL2 = (store: GraphStore.Store, taskId?: string): string => {
  const task = taskId ? store.getTask(taskId) : store.getActiveTask()
  if (!task) return ""
  const def = parseDef(task.definitionJson)

  const out: Array<string> = []
  out.push(`## Task ${task.id} (era ${task.era})`)
  out.push(`goal: ${def.goal}`)
  if (def.rootNodes.length > 0) out.push(`roots: ${joinList(def.rootNodes)}`)
  if (def.behavioralChange) out.push(`behavioral change: ${def.behavioralChange}`)
  if (def.constraints) out.push(`constraints: ${def.constraints}`)
  if (def.budget) out.push(`budget: ${def.budget}`)
  if (def.returnFormat) out.push(`return format: ${def.returnFormat}`)
  if (def.dependencyContracts)
    out.push("## Dependency contracts (read-only references)", def.dependencyContracts)

  // Acceptance criteria — live from the criteria table (set_acceptance).
  const criteria = store.getCriteria()
  if (criteria.length > 0) {
    out.push("## Acceptance criteria")
    for (const c of criteria) {
      let line = `- ${c.id}: ${c.text}`
      if (c.coveredBy.length > 0) line += `  [covered by: ${joinList(c.coveredBy)}]`
      out.push(line)
    }
  }

  // Journal — all eras, marker on entries from before the current one.
  const journal = store.getJournal(task.id)
  out.push("## Journal")
  if (journal.length === 0)
    out.push("(empty — journal_append records decisions, interface changes, sub-steps done, blockers)")
  const journalCap = 100 // last 100 entries
  const skip = Math.max(0, journal.length - journalCap)
  if (skip > 0) out.push(`(...) ${skip} earlier entries`)
  for (const entry of journal.slice(skip)) {
    if (entry.era !== task.era) out.push(`[era ${entry.era}] `)
    out.push(`#${entry.seq} ${entry.text}`)
  }

  // Scratchpad — close_node takeaways from earlier eras only.
  const scratch = store.getScratch(task.id).filter((entry) => entry.era < task.era)
  if (scratch.length > 0) {
    out.push("## Scratchpad (takeaways from earlier eras)")
    for (const entry of scratch) out.push(`- ${entry.node} — ${entry.takeaway}`)
  }
  return `${out.join("\n")}\n`
}
