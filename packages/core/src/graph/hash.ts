export * as GraphHash from "./hash.js"

import { createHash } from "node:crypto"

/**
 * Content hash over source text, used for content_hash / source_hash: stable
 * across runs and only compared for equality. Never persisted across nemora
 * stores, so the algorithm choice is free; sha-256 hex is native and fast.
 */
export const hashText = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)
