import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { Global } from "@nemoracode/util/global"
import { NEMORACODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Console, Effect, FileSystem, Option, Scope } from "effect"
import { Command } from "effect/cli"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Commands, PrintLogs, Server, Standalone } from "../src/commands/commands"
import { Spec } from "../src/framework/spec"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nemoracode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        version: NEMORACODE_VERSION,
        pid: process.pid,
        urls: [],
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    await fs.mkdir(path.dirname(registration), { recursive: true })
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        version: NEMORACODE_VERSION,
        url: server.url.toString(),
        pid: process.pid,
      }),
    )
    const resolved = await runPromise(ServerConnection.resolve())

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeDefined()
    if (!resolved.service) throw new Error("Expected managed service capabilities")
    expect(Effect.isEffect(resolved.service.reconnect())).toBe(true)
    expect(Effect.isEffect(resolved.service.restart())).toBe(true)
    expect(await runPromise(resolved.service.reconnect())).toEqual(resolved.endpoint)

    const explicit = await runPromise(ServerConnection.resolve({ server: server.url.toString() }))
    expect(explicit.endpoint.url).toBe(server.url.toString())
    expect(explicit.service).toBeUndefined()
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service options only require a matching version when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nemoracode-service-options-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    expect((await runPromise(ServiceConfig.options())).version).toBeUndefined()
    expect((await runPromise(ServiceConfig.options({ checkVersion: true }))).version).toBe(NEMORACODE_VERSION)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("global --server and --standalone flags parse in any position for server-connecting commands and reject on local-only commands", async () => {
  const captured: Array<{
    readonly path: string
    readonly server: string | undefined
    readonly standalone: boolean
  }> = []

  function bindTree(
    node: Spec.Any,
    prefix: ReadonlyArray<string> = [],
  ): Command.Command<string, unknown, unknown, unknown, never> {
    const currentPath = [...prefix, node.name].join(" ")
    const withHandler = node.spec.pipe(
      Command.withHandler((input: Record<string, unknown>) =>
        Effect.gen(function* () {
          const serverFlag = yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten))
          const standaloneFlag = yield* Effect.serviceOption(Standalone)
          const inputServer = Option.isOption(input.server)
            ? Option.getOrUndefined(input.server as Option.Option<string>)
            : undefined
          const inputStandalone = typeof input.standalone === "boolean" ? input.standalone : undefined
          captured.push({
            path: currentPath,
            server: inputServer ?? Option.getOrUndefined(serverFlag),
            standalone: inputStandalone ?? Option.getOrElse(standaloneFlag, () => false),
          })
        }),
      ),
    ) as Command.Command<string, unknown, unknown, unknown, never>
    const children = Object.values(node.commands)
    if (children.length === 0) return withHandler
    return withHandler.pipe(
      Command.withSubcommands(children.map((child) => bindTree(child, [...prefix, node.name]))),
    ) as Command.Command<string, unknown, unknown, unknown, never>
  }

  const silentConsole: Console.Console = Object.assign(Object.create(console), {
    log: () => {},
    error: () => {},
  })

  const runArgs = (args: ReadonlyArray<string>) =>
    Effect.runPromise(
      Command.runWith(bindTree(Commands).pipe(Command.withGlobalFlags([PrintLogs])), {
        version: NEMORACODE_VERSION,
        renderErrors: false,
      })(args).pipe(Effect.provideService(Console.Console, silentConsole), Effect.provide(NodeServices.layer)),
    )

  const url = "http://127.0.0.1:43210"
  const serverCases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
    [["--server", url, "session", "list"], "nemoracode session list"],
    [["session", "--server", url, "list"], "nemoracode session list"],
    [["session", "list", "--server", url], "nemoracode session list"],
    [["session", "--server", url, "delete", "ses_123"], "nemoracode session delete"],
    [["--server", url, "plugin", "list"], "nemoracode plugin list"],
    [["plugin", "--server", url, "list"], "nemoracode plugin list"],
    [["plugin", "list", "--server", url], "nemoracode plugin list"],
    [["plugin", "--server", url, "check"], "nemoracode plugin check"],
    [["plugin", "--server", url, "update"], "nemoracode plugin update"],
    [["--server", url, "mcp", "list"], "nemoracode mcp list"],
    [["mcp", "--server", url, "list"], "nemoracode mcp list"],
    [["mcp", "list", "--server", url], "nemoracode mcp list"],
    [["mcp", "--server", url, "auth", "linear"], "nemoracode mcp auth"],
    [["mcp", "--server", url, "logout", "linear"], "nemoracode mcp logout"],
    [["auth", "--server", url, "list"], "nemoracode auth list"],
    [["debug", "--server", url, "config"], "nemoracode debug config"],
    [["debug", "--server", url, "agents"], "nemoracode debug agents"],
    [["debug", "--server", url, "heap-dump"], "nemoracode debug heap-dump"],
    [["--server", url, "models"], "nemoracode models"],
    [["models", "--server", url], "nemoracode models"],
    [["--server", url, "run", "hello"], "nemoracode run"],
    [["run", "hello", "--server", url], "nemoracode run"],
  ]

  for (const [args, expectedPath] of serverCases) {
    captured.length = 0
    await runArgs(args)
    expect(captured).toEqual([{ path: expectedPath, server: url, standalone: false }])
  }

  captured.length = 0
  await runArgs(["session", "--standalone", "list"])
  expect(captured).toEqual([{ path: "nemoracode session list", server: undefined, standalone: true }])

  await expect(runArgs(["plugin", "add", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["plugin", "remove", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["mcp", "add", "my-mcp", "--url", "https://example.com/mcp", "--server", url])).rejects.toThrow()
  await expect(runArgs(["serve", "--server", url])).rejects.toThrow()
  await expect(runArgs(["--server", url, "serve"])).rejects.toThrow()
  await expect(runArgs(["service", "status", "--server", url])).rejects.toThrow()
  await expect(runArgs(["service", "--server", url, "start"])).rejects.toThrow()
})

test("local config commands do not start or require a server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nemoracode-local-config-cmd-"))
  try {
    const env = isolatedEnv(root)
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../src/index.ts"),
        "mcp",
        "add",
        "demo",
        "--global",
        "--url",
        "https://example.com/mcp",
      ],
      {
        cwd: path.join(import.meta.dir, ".."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(stdout).toContain('MCP server "demo" added')
    const config = await Bun.file(path.join(root, "config", "nemoracode.json")).json()
    expect(config).toMatchObject({
      mcp: {
        servers: {
          demo: { type: "remote", url: "https://example.com/mcp" },
        },
      },
    })
    expect(await Bun.file(path.join(root, "state", "nemoracode", ServiceConfig.filename())).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
