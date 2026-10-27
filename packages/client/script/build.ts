import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@nemoracode/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@nemoracode/protocol/client"
import { Agent } from "@nemoracode/schema/agent"
import { Command } from "@nemoracode/schema/command"
import { Config } from "@nemoracode/schema/config"
import { Credential } from "@nemoracode/schema/credential"
import { Event } from "@nemoracode/schema/event"
import { EventLog } from "@nemoracode/schema/event-log"
import { FileDiff } from "@nemoracode/schema/file-diff"
import { FileSystem } from "@nemoracode/schema/filesystem"
import { Form } from "@nemoracode/schema/form"
import { Instruction } from "@nemoracode/schema/instruction"
import { InstructionEntry } from "@nemoracode/schema/instruction-entry"
import { Integration } from "@nemoracode/schema/integration"
import { Location } from "@nemoracode/schema/location"
import { Mcp } from "@nemoracode/schema/mcp"
import { Model } from "@nemoracode/schema/model"
import { Money } from "@nemoracode/schema/money"
import { Permission } from "@nemoracode/schema/permission"
import { PermissionSaved } from "@nemoracode/schema/permission-saved"
import { Plugin } from "@nemoracode/schema/plugin"
import { Project } from "@nemoracode/schema/project"
import { Worktree } from "@nemoracode/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@nemoracode/schema/prompt"
import { PromptInput } from "@nemoracode/schema/prompt-input"
import { Provider } from "@nemoracode/schema/provider"
import { Pty } from "@nemoracode/schema/pty"
import { PtyTicket } from "@nemoracode/schema/pty-ticket"
import { Question } from "@nemoracode/schema/question"
import { Reference } from "@nemoracode/schema/reference"
import { AbsolutePath, RelativePath } from "@nemoracode/schema/schema"
import { Session } from "@nemoracode/schema/session"
import { SessionMessage } from "@nemoracode/schema/session-message"
import { SessionInbox } from "@nemoracode/schema/session-inbox"
import { Shell } from "@nemoracode/schema/shell"
import { Skill } from "@nemoracode/schema/skill"
import { Snapshot } from "@nemoracode/schema/snapshot"
import { UsageLimits } from "@nemoracode/schema/usage-limits"
import { Vcs } from "@nemoracode/schema/vcs"
import { WebSearch } from "@nemoracode/schema/websearch"
import { Workspace } from "@nemoracode/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@nemoracode/schema/agent", Agent),
  ...namespaceTypes("Command", "@nemoracode/schema/command", Command),
  ...namespaceTypes("Config", "@nemoracode/schema/config", Config),
  ...namespaceTypes("Credential", "@nemoracode/schema/credential", Credential),
  ...namespaceTypes("Event", "@nemoracode/schema/event", Event),
  ...namespaceTypes("EventLog", "@nemoracode/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@nemoracode/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@nemoracode/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@nemoracode/schema/form", Form),
  ...namespaceTypes("Instruction", "@nemoracode/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@nemoracode/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@nemoracode/schema/integration", Integration),
  typeReference("Location.PublicRef", "@nemoracode/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@nemoracode/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@nemoracode/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@nemoracode/schema/model", Model),
  ...namespaceTypes("Money", "@nemoracode/schema/money", Money),
  ...namespaceTypes("Permission", "@nemoracode/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@nemoracode/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@nemoracode/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@nemoracode/schema/project", Project),
  ...namespaceTypes("Worktree", "@nemoracode/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@nemoracode/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@nemoracode/schema/provider", Provider),
  ...namespaceTypes("Pty", "@nemoracode/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@nemoracode/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@nemoracode/schema/question", Question),
  ...namespaceTypes("Reference", "@nemoracode/schema/reference", Reference),
  ...namespaceTypes("Session", "@nemoracode/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@nemoracode/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@nemoracode/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@nemoracode/schema/shell", Shell),
  ...namespaceTypes("Skill", "@nemoracode/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@nemoracode/schema/snapshot", Snapshot),
  ...namespaceTypes("UsageLimits", "@nemoracode/schema/usage-limits", UsageLimits),
  ...namespaceTypes("Vcs", "@nemoracode/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@nemoracode/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@nemoracode/schema/workspace", Workspace),
  typeReference("Prompt", "@nemoracode/schema/prompt", Prompt),
  typeReference("PromptMention", "@nemoracode/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@nemoracode/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@nemoracode/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@nemoracode/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@nemoracode/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "NemoraCodeEvent",
              import: 'import type { NemoraCodeEvent } from "@nemoracode/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
