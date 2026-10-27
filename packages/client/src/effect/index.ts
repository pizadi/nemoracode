// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { NemoraCode } from "./client.js"

export * from "./generated/index"
export { NemoraCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@nemoracode/schema/agent"
export { Command } from "@nemoracode/schema/command"
export { Config } from "@nemoracode/schema/config"
export { Credential } from "@nemoracode/schema/credential"
export { Event } from "@nemoracode/schema/event"
export { EventLog } from "@nemoracode/schema/event-log"
export { FileSystem } from "@nemoracode/schema/filesystem"
export { Form } from "@nemoracode/schema/form"
export { Integration } from "@nemoracode/schema/integration"
export { Location } from "@nemoracode/schema/location"
export { Model } from "@nemoracode/schema/model"
export { Permission } from "@nemoracode/schema/permission"
export { PermissionSaved } from "@nemoracode/schema/permission-saved"
export { Project } from "@nemoracode/schema/project"
export { Worktree } from "@nemoracode/schema/worktree"
export { Vcs } from "@nemoracode/schema/vcs"
export { Provider } from "@nemoracode/schema/provider"
export { Pty } from "@nemoracode/schema/pty"
export { Question } from "@nemoracode/schema/question"
export { Reference } from "@nemoracode/schema/reference"
export { WebSearch } from "@nemoracode/schema/websearch"
export { AbsolutePath, RelativePath } from "@nemoracode/schema/schema"
export { Session } from "@nemoracode/schema/session"
export { SessionInbox } from "@nemoracode/schema/session-inbox"
export { SessionMessage } from "@nemoracode/schema/session-message"
export { Skill } from "@nemoracode/schema/skill"
export { Prompt } from "@nemoracode/schema/prompt"
export { PromptInput } from "@nemoracode/schema/prompt-input"
export type { NemoraCodeEvent } from "@nemoracode/protocol/groups/event"
export type NemoraCodeClient = Effect.Success<ReturnType<typeof NemoraCode.make>>
