// Type-compatible with the bun variant so callers typecheck identically.
// The graph store ships for the bun runtime; the node entry throws at open.
import type { Database } from "bun:sqlite"

export type RawDatabase = Database

export const openRaw = (path: string): RawDatabase => {
  throw new Error(`graph store cannot open "${path}": requires the bun runtime`)
}
