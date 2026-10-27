import { Option, Schema } from "effect"

declare const NEMORACODE_VERSION: string
declare const NEMORACODE_CHANNEL: string
declare const NEMORACODE_ARTIFACT: string
declare const NEMORACODE_RELEASE_HIGHLIGHTS: string

const version = typeof NEMORACODE_VERSION === "string" ? NEMORACODE_VERSION : "local"
const channel = typeof NEMORACODE_CHANNEL === "string" ? NEMORACODE_CHANNEL : "local"
const artifact = typeof NEMORACODE_ARTIFACT === "string" ? NEMORACODE_ARTIFACT : "cli"
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof NEMORACODE_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(NEMORACODE_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as NEMORACODE_VERSION,
  channel as NEMORACODE_CHANNEL,
  artifact as NEMORACODE_ARTIFACT,
  highlights as NEMORACODE_HIGHLIGHTS,
}
export const NEMORACODE_LOCAL = channel === "local"
