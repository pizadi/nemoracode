export * as GraphDescriptor from "./descriptor.js"

import type { Kind } from "./store.js"

const REQUIRED = ["summary", "purpose", "inputs", "outputs", "side_effects", "invariants", "uses"] as const

/** Collapse whitespace runs to single spaces and trim. */
const normalize = (text: string): string => text.trim().replaceAll(/\s+/g, " ")

const braceHeader = (body: string): string => {
  const pos = body.indexOf("{")
  return normalize(pos === -1 ? body : body.slice(0, pos))
}

const pythonHeader = (body: string): string => {
  // Header = lines up to and including the first line whose trimmed content
  // ends with ':' while paren/bracket depth is 0 (multi-line signatures).
  let depth = 0
  let lineStart = 0
  for (let i = 0; i <= body.length; i++) {
    if (i !== body.length && body[i] !== "\n") continue
    const line = body.slice(lineStart, i)
    const trimmed = line.trim()
    for (const ch of trimmed) {
      if (ch === "(" || ch === "[") depth++
      else if (ch === ")" || ch === "]") depth--
    }
    if (depth <= 0 && trimmed.endsWith(":")) return normalize(body.slice(0, i))
    lineStart = i + 1
  }
  return normalize(body)
}

/**
 * True when the descriptor (a JSON object as text) has every required field.
 * On failure `missing` names every offender, comma-joined — one error per edit,
 * never one per field.
 */
export const descriptorComplete = (descriptorJson: string): { ok: true } | { ok: false; missing: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(descriptorJson)
  } catch {
    return { ok: false, missing: "(descriptor is not valid JSON)" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { ok: false, missing: "(descriptor is not a JSON object)" }
  const descriptor = parsed as Record<string, unknown>
  const miss: Array<string> = []
  for (const key of REQUIRED) {
    const value = descriptor[key]
    if (value === undefined || value === null) {
      miss.push(key)
      continue
    }
    if ((key === "summary" || key === "purpose") && (typeof value !== "string" || value.length === 0))
      miss.push(key)
  }
  return miss.length === 0 ? { ok: true } : { ok: false, missing: miss.join(", ") }
}

/**
 * The signature portion of a definition's body: everything before the first
 * '{' (brace languages) or up to and including the dedented ':' line
 * (python). Whitespace-normalized, so reformatting an edit doesn't read as a
 * contract change. `lang` is a config language name; unknown languages return
 * the normalized whole body.
 */
export const signatureHeader = (body: string, lang: string): string =>
  lang === "python" ? pythonHeader(body) : braceHeader(body)

/** True for node kinds whose signature is part of their contract. */
export const contractBearingKind = (kind: Kind): boolean =>
  kind === "module" || kind === "class" || kind === "function" || kind === "method"
