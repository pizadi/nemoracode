import { Agent } from "@nemoracode/core/agent"
import { AISDK } from "@nemoracode/core/aisdk"
import { Command } from "@nemoracode/core/command"
import { Config } from "@nemoracode/core/config"
import { Credential } from "@nemoracode/core/credential"
import { Database } from "@nemoracode/core/database/database"
import { FileAccess } from "@nemoracode/core/file-access"
import { LayerNodePlatform } from "@nemoracode/util/effect/app-node-platform"
import { AppProcess } from "@nemoracode/util/process"
import { LayerNode } from "@nemoracode/util/effect/layer-node"
import { Bus } from "@nemoracode/core/bus"
import { FileSystem } from "@nemoracode/core/filesystem"
import { FSUtil } from "@nemoracode/util/fs-util"
import { Form } from "@nemoracode/core/form"
import { Generate } from "@nemoracode/core/generate"
import { Integration } from "@nemoracode/core/integration"
import { KV } from "@nemoracode/core/kv"
import { Location } from "@nemoracode/core/location"
import { ManagedPolicy } from "@nemoracode/core/managed-policy"
import { Mcp } from "@nemoracode/core/mcp/index"
import { Model } from "@nemoracode/core/model"
import { Npm } from "@nemoracode/util/npm"
import { Plugin } from "@nemoracode/core/plugin"
import { PluginHooks } from "@nemoracode/core/plugin/hooks"
import { Provider } from "@nemoracode/core/provider"
import { Session } from "@nemoracode/core/session"
import { PersistentPty } from "@nemoracode/core/persistent-pty"
import { LocationServiceMap } from "@nemoracode/core/location-service-map"
import { AppNodeBuilder } from "@nemoracode/core/effect/app-node-builder"
import { Permission } from "@nemoracode/core/permission"
import { Reference } from "@nemoracode/core/reference"
import { Rpc } from "@nemoracode/core/rpc"
import { Skill } from "@nemoracode/core/skill"
import { SkillDiscovery } from "@nemoracode/core/skill/discovery"
import { Watcher } from "@nemoracode/core/filesystem/watcher"
import { Tool } from "@nemoracode/core/tool"
import { Vcs } from "@nemoracode/core/vcs"
import { WebSearch } from "@nemoracode/core/websearch"
import { Worktree } from "@nemoracode/core/worktree"
import { WorktreeStrategies } from "@nemoracode/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(Generate.Service, Generate.Service.of({ text: () => Effect.succeed("") }))

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayer = (permission = permissionLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Database.node,
      FileAccess.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      Integration.node,
      KV.node,
      ManagedPolicy.node,
      Mcp.node,
      Session.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generateLayer),
      Permission.node.replace(permission),
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
