export * as GraphIngest from "./ingest.js"

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { GraphAdapter, type LangAdapter } from "./adapter.js"
import { TsAdapter } from "./ts-adapter.js"
import { GraphHash } from "./hash.js"
import { GraphStore, type EdgeSpec, type Kind, type NodeSpec } from "./store.js"

// Guards shared with the read-side tools (search_text).
const BINARY_CHECK_BYTES = 8192
const MAX_PARSE_BYTES = 256 * 1024
const MAX_CALL_CANDIDATES = 5

// ponytail: fixed skip list instead of honoring .gitignore (this repo
// gitignores its own src/); extend it if real projects drown in noise.
const SKIP_DIRS = new Set([
  ".git",
  ".plan",
  ".work",
  ".nemora",
  ".nemoracode",
  "work",
  "build",
  "node_modules",
  "target",
  "dist",
  "__pycache__",
  ".venv",
  "venv",
])

function walk(dir: string, rel: string, files: Array<string>, dirs: Array<string>): void {
  let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }))
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith(".")) continue // hidden + .git
    const child = rel ? `${rel}/${name}` : name
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(name)) continue
      dirs.push(`${child}/`)
      walk(join(dir, name), child, files, dirs)
    } else if (entry.isFile) {
      files.push(child)
    }
  }
}

const extensionOf = (path: string): string => {
  const pos = path.lastIndexOf(".")
  const slash = path.lastIndexOf("/")
  if (pos === -1 || (slash !== -1 && pos < slash)) return ""
  return path.slice(pos).toLowerCase()
}

const languageOfExt = (ext: string): string => {
  if (ext === ".c") return "c"
  if (ext === ".h" || ext === ".hh" || ext === ".hpp" || ext === ".cc" || ext === ".cpp" || ext === ".cxx")
    return "cpp" // the cpp grammar is a near-superset; .h rides on it
  if (ext === ".py") return "python"
  if (ext === ".ts" || ext === ".tsx") return "typescript"
  if (ext === ".rs") return "rust"
  return ""
}

const parserOfExt = (ext: string): string => (ext === ".tsx" ? "tsx" : languageOfExt(ext))

/** NUL byte in the first BINARY_CHECK_BYTES. */
export const looksBinary = (bytes: string): boolean => bytes.slice(0, BINARY_CHECK_BYTES).includes("\u0000")

/** Config language name for a file path ("" when no approved language matches). */
export const languageForFile = (path: string): string => languageOfExt(extensionOf(path))

/** True when the store is missing or any walked source file has an mtime newer than the db file. */
export const storeStale = (dbPath: string, root: string): boolean => {
  let dbTime: number
  try {
    dbTime = statSync(dbPath).mtimeMs
  } catch {
    return true
  }
  const files: Array<string> = []
  const dirs: Array<string> = []
  walkTree(root, files, dirs)
  for (const file of files) {
    let time: number
    try {
      time = statSync(join(root, file)).mtimeMs
    } catch {
      continue
    }
    if (time > dbTime) return true
  }
  return false
}

export function walkTree(root: string, files: Array<string>, dirs: Array<string>): void {
  walk(root, "", files, dirs)
}

// "::" qualified names become dotted ("A::B" -> "A.B").
const normalizeName = (name: string): string => name.replaceAll("::", ".")

interface DefInfo {
  id: string
  full: string // dotted qualifier chain, e.g. "geo.Shape.area"
  simple: string // last segment
  start: number
  end: number
}

export interface IngestStats {
  files: number
  binaryFiles: number // skipped: NUL byte in the first 8 KB
  bigFiles: number // skipped: larger than 256 KB
  parseFailed: number // tree-sitter ERROR nodes (partial results still used)
  parseFailedFiles: Array<string>
  dirNodes: number
  fileNodes: number
  defNodes: number
  regionNodes: number // fallback-chunked regions
  callEdges: number
  importEdges: number
  extendsEdges: number
  implementsEdges: number
  droppedRefs: number // ambiguous (>5 candidates) or unresolvable
  unresolvedImports: number // import spec with no matching file on disk
}

/**
 * Walks `root` (project root), parses every text file with the tree-sitter
 * adapter for its extension (or the blank-line fallback chunker for other
 * text), and rebuilds `store`'s whole graph from it: directory nodes for the
 * walk, a file node per file, one node per definition (containment-nested),
 * and parsed edges (calls, imports, extends, implements). `languages` is the
 * approved config list (c, cpp, python, typescript, rust).
 */
export async function ingest(store: GraphStore.Store, root: string, languages: ReadonlyArray<string>): Promise<IngestStats> {
  const stats: IngestStats = {
    files: 0,
    binaryFiles: 0,
    bigFiles: 0,
    parseFailed: 0,
    parseFailedFiles: [],
    dirNodes: 0,
    fileNodes: 0,
    defNodes: 0,
    regionNodes: 0,
    callEdges: 0,
    importEdges: 0,
    extendsEdges: 0,
    implementsEdges: 0,
    droppedRefs: 0,
    unresolvedImports: 0,
  }
  const approved = new Set(languages)
  const adapters = new Map<string, LangAdapter>()
  for (const lang of approved) {
    const adapter = await TsAdapter.makeTreeSitterAdapter(lang)
    if (adapter) adapters.set(lang, adapter)
    if (lang === "typescript") {
      const tsx = await TsAdapter.makeTreeSitterAdapter("tsx")
      if (tsx) adapters.set("tsx", tsx)
    }
  }

  const files: Array<string> = []
  const dirs: Array<string> = []
  walk(root, "", files, dirs)
  files.sort()
  dirs.sort()
  const fileSet = new Set(files)

  // --- parse pass -----------------------------------------------------------
  interface Parsed {
    path: string
    bytes: string
    parsed: GraphAdapter.ParseResult
    adapter?: LangAdapter // undefined: binary/oversized/no grammar — fallback or none
  }
  const parsedFiles: Array<Parsed> = []
  const indent = new GraphAdapter.IndentAdapter()
  for (const rel of files) {
    const bytes = readFileSync(join(root, rel), "utf8")
    stats.files++
    const ext = extensionOf(rel)
    const lang = languageOfExt(ext)
    const parsed: Parsed = { path: rel, bytes, parsed: { defs: [], refs: [], imports: [], parseFailed: false } }
    if (looksBinary(bytes)) {
      stats.binaryFiles++
    } else if (bytes.length > MAX_PARSE_BYTES) {
      stats.bigFiles++
    } else {
      const adapter = adapters.get(parserOfExt(ext))
      if (lang && approved.has(lang) && adapter) {
        parsed.adapter = adapter
        parsed.parsed = adapter.parse(bytes)
        if (parsed.parsed.parseFailed) {
          stats.parseFailed++
          stats.parseFailedFiles.push(rel)
        }
      } else {
        parsed.parsed = indent.parse(bytes) // fallback regions
      }
    }
    parsedFiles.push(parsed)
  }

  // --- nodes: one file node per file, defs containment-nested under it ------
  const specs: Array<NodeSpec> = []
  const defsByFile = new Map<string, Array<DefInfo>>()
  const idSeen = new Map<string, number>()

  for (const pf of parsedFiles) {
    const lineCount = 1 + (pf.bytes.match(/\n/g)?.length ?? 0)
    specs.push({
      id: pf.path,
      parent: pf.path.includes("/") ? pf.path.slice(0, pf.path.lastIndexOf("/") + 1) : ".",
      kind: "file",
      ord: 0,
      anchor: { file: pf.path, startByte: 0, endByte: pf.bytes.length, startLine: 1, endLine: lineCount },
      contentHash: GraphHash.hashText(pf.bytes),
    })
    stats.fileNodes++

    const fileDefs: Array<DefInfo> = []
    defsByFile.set(pf.path, fileDefs)

    // Sort: start asc, end desc — outer definitions before inner at ties.
    const hits = [...pf.parsed.defs].toSorted((a, b) => a.range.start - b.range.start || b.range.end - a.range.end)
    // Parent = innermost containing def (stack over the sorted hits).
    const parent: Array<number> = new Array(hits.length).fill(-1)
    const stack: Array<number> = []
    for (let i = 0; i < hits.length; i++) {
      while (stack.length && hits[stack.at(-1)!].range.end <= hits[i].range.start) stack.pop()
      parent[i] = stack.length ? stack.at(-1)! : -1
      stack.push(i)
    }
    // Ids and specs; parents are processed before children by sort order.
    const ids: Array<string> = new Array(hits.length)
    const fulls: Array<string> = new Array(hits.length)
    const ordCounter = new Map<number, number>()
    for (let i = 0; i < hits.length; i++) {
      const norm = normalizeName(hits[i].name)
      fulls[i] = parent[i] < 0 ? norm : `${fulls[parent[i]]}.${norm}`
      const base = `${pf.path}::${fulls[i]}`
      const seen = (idSeen.get(base) ?? 0) + 1
      idSeen.set(base, seen)
      ids[i] = seen === 1 ? base : `${base}#${seen}`

      const parentKind = parent[i] >= 0 ? hits[parent[i]].kind : ""
      let kind: Kind = "function"
      if (hits[i].kind === "class") kind = "class"
      else if (hits[i].kind === "module") kind = "module"
      else if (hits[i].kind === "region") kind = "region"
      else if (parentKind === "class") kind = "method"

      specs.push({
        id: ids[i],
        parent: parent[i] < 0 ? pf.path : ids[parent[i]],
        kind,
        ord: ordCounter.get(parent[i]) ?? 0,
        anchor: {
          file: pf.path,
          startByte: hits[i].range.start,
          endByte: hits[i].range.end,
          startLine: hits[i].range.startLine,
          endLine: hits[i].range.endLine,
        },
        contentHash: GraphHash.hashText(pf.bytes.slice(hits[i].range.start, hits[i].range.end)),
      })
      ordCounter.set(parent[i], (ordCounter.get(parent[i]) ?? 0) + 1)
      if (kind === "region") stats.regionNodes++
      else stats.defNodes++

      const dot = fulls[i].lastIndexOf(".")
      const simple = dot === -1 ? fulls[i] : fulls[i].slice(dot + 1)
      fileDefs.push({ id: ids[i], full: fulls[i], simple, start: hits[i].range.start, end: hits[i].range.end })
    }
  }

  // --- edges ------------------------------------------------------------------
  const edges: Array<EdgeSpec> = []
  const importsOf = new Map<string, Array<string>>()

  for (const pf of parsedFiles) {
    if (!pf.adapter) continue // fallback/binary files carry no edges
    const imported: Array<string> = []
    for (const imp of pf.parsed.imports) {
      const candidates = pf.adapter.importCandidates(pf.path, imp)
      const ok = candidates.filter((c) => c !== pf.path && fileSet.has(c))
      if (ok.length === 0) {
        stats.unresolvedImports++
        continue
      }
      const conf = 1 / ok.length
      for (const c of ok) {
        edges.push({ src: pf.path, dst: c, type: "imports", confidence: conf })
        stats.importEdges++
        if (!imported.includes(c)) imported.push(c)
      }
    }
    importsOf.set(pf.path, imported)
  }

  const byName = new Map<string, Array<DefInfo>>()
  for (const vec of defsByFile.values())
    for (const def of vec) byName.set(def.simple, [...(byName.get(def.simple) ?? []), def])

  // Tiered name resolution: same file, then imported files, then global.
  const resolve = (file: string, rawName: string, imported: ReadonlyArray<string>): Array<DefInfo> => {
    const name = normalizeName(rawName)
    const inDefs = (defs: Array<DefInfo>) => defs.filter((def) => def.full === name || def.simple === name)
    let candidates = inDefs(defsByFile.get(file) ?? [])
    if (candidates.length === 0)
      for (const f of imported) {
        candidates = [...candidates, ...inDefs(defsByFile.get(f) ?? [])]
      }
    if (candidates.length === 0) candidates = byName.get(name) ?? []
    return candidates
  }
  // Innermost def whose byte range contains the reference position.
  const innermost = (file: string, byte: number): string => {
    let best: DefInfo | undefined
    for (const def of defsByFile.get(file) ?? []) {
      if (def.start <= byte && byte < def.end && (!best || def.start > best.start)) best = def
    }
    return best ? best.id : file // top-level refs belong to the file node
  }

  for (const pf of parsedFiles) {
    if (!pf.adapter) continue
    const imported = importsOf.get(pf.path) ?? []
    for (const ref of pf.parsed.refs) {
      let srcId: string
      if (ref.subject) {
        // Rust `impl Trait for X`: attribute to X by name, not by byte.
        const c = resolve(pf.path, ref.subject, imported)
        if (c.length !== 1) {
          stats.droppedRefs++
          continue
        }
        srcId = c[0].id
      } else {
        srcId = innermost(pf.path, ref.byte)
      }
      const candidates = resolve(pf.path, ref.name, imported)
      if (candidates.length === 0 || candidates.length > MAX_CALL_CANDIDATES) {
        stats.droppedRefs++
        continue
      }
      const conf = 1 / candidates.length
      for (const c of candidates) {
        if (c.id === srcId) continue // recursion: no self-edge
        const type = ref.kind === "call" ? "calls" : ref.kind === "extends" ? "extends" : "implements"
        edges.push({ src: srcId, dst: c.id, type, confidence: conf })
        if (type === "calls") stats.callEdges++
        else if (type === "extends") stats.extendsEdges++
        else stats.implementsEdges++
      }
    }
  }

  stats.dirNodes = dirs.length
  store.rebuild(specs, edges, dirs)
  return stats
}
