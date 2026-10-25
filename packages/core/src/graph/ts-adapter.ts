export * as TsAdapter from "./ts-adapter.js"

import { fileURLToPath } from "node:url"
import path from "node:path"
import type { Query, QueryMatch, Node as TsNode } from "web-tree-sitter"
import { graphParserWasm } from "#graph-parser-wasm"
import type { ByteRange, DefHit, ImportHit, LangAdapter, ParseResult, RefKind, RefHit } from "./adapter.js"

const resolve = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

// One tags-style query per language. Captures:
//   @def.<kind>  whole definition node (kind: class | function | module |
//                region) — method vs function is decided by nesting in ingest
//   @nm          the name node
//   @ref.call / @ref.extends / @ref.implements   the referenced name node
//   @import      the import spec node (quotes included; stripped here)
//   @impl.type / @impl.trait   Rust impl context: methods inside `impl X` get
//                an "X." name prefix; `impl Trait for X` yields an implements
//                ref whose subject is X.
const QUERIES: Record<string, string> = {
  python: `
(class_definition name: (identifier) @nm) @def.class
(function_definition name: (identifier) @nm) @def.function
(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
(class_definition superclasses: (argument_list (identifier) @ref.extends))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @ref.extends)))
(import_statement name: (dotted_name) @import)
(import_statement name: (aliased_import name: (dotted_name) @import))
(import_from_statement module_name: (dotted_name) @import)
(import_from_statement module_name: (relative_import) @import)
`,
  c: `
(function_definition declarator: (function_declarator declarator: (identifier) @nm)) @def.function
(struct_specifier name: (type_identifier) @nm body: (field_declaration_list)) @def.class
(enum_specifier name: (type_identifier) @nm body: (enumerator_list)) @def.class
(union_specifier name: (type_identifier) @nm body: (field_declaration_list)) @def.class
(call_expression function: (identifier) @ref.call)
(preproc_include path: (string_literal) @import)
`,
  cpp: `
(function_definition declarator: (function_declarator declarator: (identifier) @nm)) @def.function
(function_definition declarator: (function_declarator declarator: (qualified_identifier) @nm)) @def.function
(function_definition declarator: (function_declarator declarator: (field_identifier) @nm)) @def.function
(field_declaration declarator: (function_declarator declarator: (field_identifier) @nm)) @def.function
(class_specifier name: (type_identifier) @nm body: (field_declaration_list)) @def.class
(struct_specifier name: (type_identifier) @nm body: (field_declaration_list)) @def.class
(enum_specifier name: (type_identifier) @nm body: (enumerator_list)) @def.class
(namespace_definition name: (namespace_identifier) @nm) @def.module
(call_expression function: (identifier) @ref.call)
(call_expression function: (field_expression field: (field_identifier) @ref.call))
(call_expression function: (qualified_identifier) @ref.call)
(base_class_clause (type_identifier) @ref.extends)
(preproc_include path: (string_literal) @import)
`,
  typescript: `
(class_declaration name: (type_identifier) @nm) @def.class
(abstract_class_declaration name: (type_identifier) @nm) @def.class
(interface_declaration name: (type_identifier) @nm) @def.class
(enum_declaration name: (identifier) @nm) @def.class
(function_declaration name: (identifier) @nm) @def.function
(method_definition name: (property_identifier) @nm) @def.function
(method_signature name: (property_identifier) @nm) @def.function
(variable_declarator name: (identifier) @nm value: (arrow_function)) @def.function
(internal_module name: (identifier) @nm) @def.module
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(extends_type_clause (type_identifier) @ref.extends)
(implements_clause (type_identifier) @ref.implements)
(import_statement source: (string) @import)
(export_statement source: (string) @import)
`,
  rust: `
(struct_item name: (type_identifier) @nm) @def.class
(enum_item name: (type_identifier) @nm) @def.class
(union_item name: (type_identifier) @nm) @def.class
(trait_item name: (type_identifier) @nm) @def.class
(function_item name: (identifier) @nm) @def.function
(function_signature_item name: (identifier) @nm) @def.function
(mod_item name: (identifier) @nm body: (declaration_list)) @def.module
(impl_item trait: (type_identifier) @impl.trait type: (type_identifier) @impl.type)
(impl_item type: (type_identifier) @impl.type body: (declaration_list (function_item name: (identifier) @nm) @def.function))
(trait_item bounds: (trait_bounds (type_identifier) @ref.extends))
(mod_item name: (identifier) @import)
`,
}

const rangeOf = (node: TsNode): ByteRange => ({
  start: node.startIndex,
  end: node.endIndex,
  startLine: node.startPosition.row + 1,
  endLine: node.endPosition.row + 1,
})

/** Directory part of a project-relative file path ("" for root-level files). */
const dirOf = (from: string): string => {
  const pos = from.lastIndexOf("/")
  return pos === -1 ? "" : from.slice(0, pos)
}

export class TreeSitterAdapter implements LangAdapter {
  private constructor(
    private readonly languageName: string,
    private readonly parser: import("web-tree-sitter").Parser,
    private readonly query: Query,
  ) {}

  static async make(languageName: string): Promise<TreeSitterAdapter> {
    const { Parser, Language, Query } = await import("web-tree-sitter")
    await Parser.init({ locateFile: () => resolve(graphParserWasm.runtime) })
    const language = await Language.load(resolve(graphParserWasm[languageName]))
    const parser = new Parser()
    parser.setLanguage(language)
    return new TreeSitterAdapter(languageName, parser, new Query(language, QUERIES[languageName]))
  }

  parse(src: string): ParseResult {
    const tree = this.parser.parse(src)
    if (!tree) return { defs: [], refs: [], imports: [], parseFailed: true }
    const defs = new Map<string, { hit: DefHit; priority: number }>()
    const refs: Array<RefHit> = []
    const imports: Array<ImportHit> = []

    const handleMatch = (m: QueryMatch) => {
      let nm: TsNode | undefined
      let defNode: TsNode | undefined
      let defKind = ""
      let refNode: TsNode | undefined
      let refKind: RefKind = "call"
      let importNode: TsNode | undefined
      let implType: TsNode | undefined
      let implTrait: TsNode | undefined
      for (const capture of m.captures) {
        const name = capture.name
        const node = capture.node
        if (name === "nm") nm = node
        else if (name.startsWith("def.")) {
          defNode = node
          defKind = name.slice(4)
        } else if (name === "ref.call") {
          refNode = node
          refKind = "call"
        } else if (name === "ref.extends") {
          refNode = node
          refKind = "extends"
        } else if (name === "ref.implements") {
          refNode = node
          refKind = "implements"
        } else if (name === "import") importNode = node
        else if (name === "impl.type") implType = node
        else if (name === "impl.trait") implTrait = node
      }

      if (defNode && nm) {
        let name = src.slice(nm.startIndex, nm.endIndex)
        let priority = 0
        if (implType) {
          name = `${src.slice(implType.startIndex, implType.endIndex)}.${name}`
          priority = 1
        }
        const hit: DefHit = { kind: defKind as DefHit["kind"], name, range: rangeOf(defNode) }
        const key = `${hit.range.start}:${hit.range.end}`
        const existing = defs.get(key)
        // impl-context matches win over the generic fn pattern
        if (!existing || priority > existing.priority) defs.set(key, { hit, priority })
        return
      }
      if (implType && implTrait) {
        // `impl Trait for X`
        refs.push({
          kind: "implements",
          name: src.slice(implTrait.startIndex, implTrait.endIndex),
          subject: src.slice(implType.startIndex, implType.endIndex),
          byte: implType.startIndex,
        })
        return
      }
      if (refNode) {
        refs.push({ kind: refKind, name: src.slice(refNode.startIndex, refNode.endIndex), byte: refNode.startIndex })
        return
      }
      if (importNode) {
        let text = src.slice(importNode.startIndex, importNode.endIndex)
        if (
          text.length >= 2 &&
          (text[0] === '"' || text[0] === "<") &&
          text.at(-1) === (text[0] === '"' ? '"' : ">")
        )
          text = text.slice(1, -1)
        if (this.languageName === "python") {
          let dots = 0
          while (dots < text.length && text[dots] === ".") dots++
          imports.push({ spec: text.slice(dots), level: dots })
        } else {
          imports.push({ spec: text, level: 0 })
        }
      }
    }
    for (const match of this.query.matches(tree.rootNode)) handleMatch(match)

    return {
      // std::map iterated in key order: defs sorted by (start, end).
      defs: [...defs.values()].toSorted((a, b) => a.hit.range.start - b.hit.range.start || a.hit.range.end - b.hit.range.end).map((entry) => entry.hit),
      refs,
      imports,
      parseFailed: tree.rootNode.hasError,
    }
  }

  importCandidates(fromFile: string, hit: ImportHit): Array<string> {
    if (this.languageName === "python") {
      const out: Array<string> = []
      let base = dirOf(fromFile)
      for (let i = 1; i < hit.level && base; i++) base = dirOf(base)
      if (hit.spec) {
        const p = hit.spec.replaceAll(".", "/")
        const prefix = base ? `${base}/${p}` : p
        out.push(`${prefix}.py`, `${prefix}/__init__.py`)
      } else if (hit.level > 0 && base) {
        out.push(`${base}/__init__.py`) // `from . import x`
      }
      return out
    }
    if (this.languageName === "c" || this.languageName === "cpp") {
      // Quote includes: the file's own directory, then each ancestor up to the
      // project root (covers -I flags pointing at ancestors).
      const out: Array<string> = []
      if (!hit.spec || hit.spec.startsWith("<")) return out
      let dir = dirOf(fromFile)
      for (;;) {
        const candidate = dir ? `${dir}/${hit.spec}` : hit.spec
        if (out.at(-1) !== candidate) out.push(candidate)
        if (!dir) break
        dir = dirOf(dir)
      }
      return out
    }
    if (this.languageName === "typescript" || this.languageName === "tsx") {
      const out: Array<string> = []
      if (!hit.spec.startsWith(".")) return out // node_modules: skip
      const dir = dirOf(fromFile)
      const joined = dir ? `${dir}/${hit.spec}` : hit.spec
      const p = path.posix.normalize(joined)
      for (const candidate of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) out.push(candidate)
      return out
    }
    if (this.languageName === "rust") {
      const out: Array<string> = []
      if (hit.level !== 0 || !hit.spec) return out
      const dir = dirOf(fromFile)
      const prefix = dir ? `${dir}/${hit.spec}` : hit.spec
      out.push(`${prefix}.rs`, `${prefix}/mod.rs`)
      return out
    }
    return []
  }
}

/** Adapter for a tree-sitter language, or undefined for an unknown language. */
export const makeTreeSitterAdapter = (language: string): Promise<TreeSitterAdapter | undefined> =>
  QUERIES[language] ? TreeSitterAdapter.make(language) : Promise.resolve(undefined)
