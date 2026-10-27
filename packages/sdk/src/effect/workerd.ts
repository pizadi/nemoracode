export * as NemoraCodeWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { NemoraCode } from "./nemoracode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: NemoraCode.CreateOptions["log"]
  readonly plugins?: NemoraCode.CreateOptions["plugins"]
  readonly workspaceProviders?: NemoraCode.CreateOptions["workspaceProviders"]
  readonly instances?: NemoraCode.CreateOptions<R>["instances"]
}

export const create = <R = never>({ log, plugins, workspaceProviders, instances, ...options }: CreateOptions<R>) => {
  const profile = WorkerdProfile.make(options)
  return NemoraCode.create(
    { ...profile.options, log, plugins, workspaceProviders, instances },
    { overrides: profile.replacements },
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<NemoraCode.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(NemoraCode.Service, create(options))

export type Interface = NemoraCode.Interface
export type Requirements = Scope.Scope
