import { EOL } from "node:os"
import { Effect } from "effect"
import { NemoraCode } from "@nemoracode/client"
import { Service } from "@nemoracode/client/effect/service"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.reload,
  Effect.fn("cli.reload")(function* () {
    const server = yield* ServerConnection.resolve()
    const client = NemoraCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    yield* Effect.tryPromise({
      try: (signal) => client.location.reload({ signal }),
      catch: (cause) => cause,
    })
    process.stdout.write("Configuration reloaded" + EOL)
  }),
)
