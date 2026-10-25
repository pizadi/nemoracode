import { Database } from "bun:sqlite"

export type RawDatabase = Database

export const openRaw = (path: string): RawDatabase => new Database(path, { create: true })
