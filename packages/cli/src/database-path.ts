import path from "node:path"
import { NEMORACODE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.NEMORACODE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(NEMORACODE_CHANNEL) ||
    process.env.NEMORACODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.NEMORACODE_DISABLE_CHANNEL_DB === "true"
      ? "nemoracode.db"
      : `nemoracode-${NEMORACODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
