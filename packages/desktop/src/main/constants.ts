import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.NEMORACODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.NEMORACODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "NemoraCode Dev",
  beta: "NemoraCode Beta",
  prod: "NemoraCode",
}

const appIDs: Record<string, string> = {
  dev: "ai.nemoracode.desktop.dev",
  beta: "ai.nemoracode.desktop.beta",
  prod: "ai.nemoracode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "NemoraCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.nemoracode.desktop.dev"
