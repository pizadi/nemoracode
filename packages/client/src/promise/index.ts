import type { NemoraCode } from "./client.js"

export * from "./generated/index.js"
export { NemoraCode } from "./client.js"
export type {
  AgentApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcCallOptions,
  RpcClient,
  RpcEventPayload,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as NemoraCodeEvent } from "./generated/types.js"
export type NemoraCodeClient = ReturnType<typeof NemoraCode.make>
