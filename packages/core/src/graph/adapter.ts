export * as GraphAdapter from "./adapter.js"

// Captures follow the ingest convention: @def.<kind> + @nm, @ref.*, @import,
// Rust @impl.*.

export interface ByteRange {
  readonly start: number // 0-based byte offset
  readonly end: number // exclusive
  readonly startLine: number // 1-based
  readonly endLine: number
}

/** A definition found by parsing. `kind` is the capture-level kind; nesting and containment are the ingest core's job. */
export interface DefHit {
  readonly kind: "class" | "function" | "module" | "region"
  readonly name: string // as written, possibly dotted ("A.B.f")
  readonly range: ByteRange
}

export type RefKind = "call" | "extends" | "implements"

/** A reference found by parsing. `byte` attributes it to the innermost enclosing definition; `subject` is set for Rust `impl Trait for X`. */
export interface RefHit {
  readonly kind: RefKind
  readonly name: string
  readonly byte: number
  readonly subject?: string
}

/** An import as written. `level` is the number of leading dots for relative imports; `spec` is the module path with quotes stripped. */
export interface ImportHit {
  readonly spec: string
  readonly level: number
}

export interface ParseResult {
  readonly defs: Array<DefHit>
  readonly refs: Array<RefHit>
  readonly imports: Array<ImportHit>
  readonly parseFailed: boolean
}

export interface LangAdapter {
  readonly parse: (src: string) => ParseResult
  readonly importCandidates: (fromFile: string, hit: ImportHit) => Array<string>
}

const blankLine = (src: string, start: number, end: number): boolean => {
  for (let i = start; i < end; i++) {
    if (!/\s/.test(src[i])) return false
  }
  return true
}

const startsAtColumn0 = (src: string, start: number): boolean => start < src.length && src[start] !== " " && src[start] !== "\t"

/** Fallback for text files without a grammar: splits blank-line + column-0 boundaries into Region chunks, no edges. */
export class IndentAdapter implements LangAdapter {
  parse(src: string): ParseResult {
    const defs: Array<DefHit> = []
    // Line start offsets.
    const starts: Array<number> = [0]
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1)

    interface Raw {
      start: number
      end: number
      sl: number
      el: number
      nonblank: number
    }
    const raw: Array<Raw> = []
    let open = false
    let cur: Raw = { start: 0, end: 0, sl: 1, el: 1, nonblank: 0 }
    for (let i = 0; i < starts.length; i++) {
      const begin = starts[i]
      const end = i + 1 < starts.length ? starts[i + 1] : src.length
      const blank = blankLine(src, begin, end)
      if (!open) {
        cur = { start: begin, end, sl: i + 1, el: i + 1, nonblank: 0 }
        open = true
      } else if (!blank && i > 0 && blankLine(src, starts[i - 1], begin) && startsAtColumn0(src, begin)) {
        cur.end = begin
        cur.el = i + 1 // end byte sits at the start of 0-based line i
        raw.push(cur)
        cur = { start: begin, end, sl: i + 1, el: i + 1, nonblank: 0 }
      }
      if (!blank) cur.nonblank++
      cur.end = end
      cur.el = i + 2
    }
    if (open) raw.push(cur)

    // Merge tiny regions (<2 non-blank lines) into the previous one.
    const merged: Array<Raw> = []
    for (const r of raw) {
      const prev = merged.at(-1)
      if (prev && prev.nonblank < 2) {
        prev.end = r.end
        prev.el = r.el
        prev.nonblank += r.nonblank
      } else merged.push(r)
    }

    let index = 0
    for (const r of merged) {
      index++
      defs.push({
        kind: "region",
        name: `region#${index}`,
        range: { start: r.start, end: r.end, startLine: r.sl, endLine: r.el },
      })
    }
    return { defs, refs: [], imports: [], parseFailed: false }
  }

  importCandidates(): Array<string> {
    return []
  }
}
