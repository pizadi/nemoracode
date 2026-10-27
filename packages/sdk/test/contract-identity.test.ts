import { expect, test } from "bun:test"
import { EnvironmentDriver } from "@nemoracode/core/environment/driver"
import { EnvironmentFiles } from "@nemoracode/core/environment/files"
import { Location as CoreLocation } from "@nemoracode/core/location"
import { WorkspaceDriver } from "@nemoracode/core/workspace/driver"
import { SessionInbox as CoreSessionInbox } from "@nemoracode/core/session/inbox"
import { SessionMessage as CoreSessionMessage } from "@nemoracode/core/session/message"
import { Agent } from "@nemoracode/schema/agent"
import { Config } from "@nemoracode/schema/config"
import { Event } from "@nemoracode/schema/event"
import { Location } from "@nemoracode/schema/location"
import { Model } from "@nemoracode/schema/model"
import { Project } from "@nemoracode/schema/project"
import { Provider } from "@nemoracode/schema/provider"
import { WebSearch } from "@nemoracode/schema/websearch"
import { Session } from "@nemoracode/schema/session"
import { SessionInbox } from "@nemoracode/schema/session-inbox"
import { SessionMessage } from "@nemoracode/schema/session-message"
import { Workspace } from "@nemoracode/schema/workspace"
import { Worktree } from "@nemoracode/schema/worktree"
import { Api } from "@nemoracode/server/api"
import { ClientApi, groupNames, promiseOmitEndpoints } from "@nemoracode/protocol/client"
import { compile, emitPromise } from "@nemoracode/httpapi-codegen"

const SDK = await import("../src/index")
const SDKEffect = await import("../src/effect")
const CoreAgent = await import("@nemoracode/core/agent")
const CoreModel = await import("@nemoracode/core/model")
const CoreProject = await import("@nemoracode/core/project")
const CoreSession = await import("@nemoracode/core/session")
const CoreWorktree = await import("@nemoracode/core/worktree")

test("re-exports canonical contracts directly from Schema", () => {
  expect(SDK.Agent).toBe(Agent)
  expect(SDK.Config).toBe(Config)
  expect(SDK.Event).toBe(Event)
  expect(SDK.Model).toBe(Model)
  expect(SDK.WebSearch).toBe(WebSearch)
  expect(SDK.Session).toBe(Session)
  expect(SDK.Worktree).toBe(Worktree)
  expect(SDK.Workspace).toBe(Workspace)
  expect(Object.keys(SDK).sort()).toEqual([
    "AbsolutePath",
    "Agent",
    "ClientError",
    "Command",
    "Config",
    "Credential",
    "Event",
    "FileSystem",
    "Integration",
    "Location",
    "Model",
    "NemoraCode",
    "Permission",
    "PermissionSaved",
    "Project",
    "Prompt",
    "PromptInput",
    "Provider",
    "Pty",
    "Question",
    "Reference",
    "RelativePath",
    "Session",
    "SessionInbox",
    "SessionMessage",
    "Skill",
    "Tool",
    "WebSearch",
    "Workspace",
    "Worktree",
  ])
})

test("Core and Server reuse the authoritative Schema and Protocol values", () => {
  expect(CoreAgent.ID).toBe(Agent.ID)
  expect(CoreLocation.Ref).toBe(Location.Ref)
  expect(CoreModel.Ref).toBe(Model.Ref)
  expect(CoreSession.Info).toBe(Session.Info)
  expect(CoreProject.Current).toBe(Project.Current)
  expect(CoreWorktree.DirectoryUnavailableError).toBeDefined()
  expect(CoreWorktree.List).toBe(Worktree.List)
  expect(CoreWorktree.Info).toBe(Worktree.Info)
  expect(CoreSessionInbox.Item).toBe(SessionInbox.Item)
  expect(CoreSessionInbox.User).toBe(SessionInbox.User)
  expect(CoreSessionInbox.Synthetic).toBe(SessionInbox.Synthetic)
  expect(CoreSessionMessage.Info).toBe(SessionMessage.Info)
  expect(CoreSessionMessage.AssistantText).toBe(SessionMessage.AssistantText)
  expect(Api.groups["server.session"].identifier).toBe("server.session")
  expect(Api.groups["server.project"].identifier).toBe("server.project")
  expect(Object.keys(ClientApi.groups)).toEqual(Object.keys(Api.groups))
  expect(Session.ID.create()).toStartWith("ses_")
  expect(String(Project.ID.global)).toBe("global")
  expect(String(Provider.ID.anthropic)).toBe("anthropic")
  expect(Workspace.ID.create()).toStartWith("wrk_")
})

test("client and Server contracts generate identically", () => {
  const server = compile(Api, { groupNames, omitEndpoints: promiseOmitEndpoints })
  const client = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })

  expect(emitPromise(client)).toEqual(emitPromise(server))
})

test("re-exports workspace and environment driver contracts from @nemoracode/sdk/effect", () => {
  expect(SDKEffect.WorkspaceDriver).toBe(WorkspaceDriver)
  expect(SDKEffect.EnvironmentDriver).toBe(EnvironmentDriver)
  expect(SDKEffect.EnvironmentFiles).toBe(EnvironmentFiles)
})
