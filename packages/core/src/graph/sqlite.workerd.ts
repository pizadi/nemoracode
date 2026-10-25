// The graph store indexes local project files, which the workerd runtime never sees.
// The type matches the bun variant so callers typecheck identically; openRaw throws.
import type { Database } from "bun:sqlite"

export type RawDatabase = Database

export const openRaw = (path: string): RawDatabase => {
  throw new Error(`graph store cannot open "${path}": not supported on this runtime`)
}
