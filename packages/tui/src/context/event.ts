import type { NemoraCodeEvent } from "@nemoracode/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type NemoraCodeEventMap = { [Type in NemoraCodeEvent["type"]]: Extract<NemoraCodeEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: NemoraCodeEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends NemoraCodeEvent["type"]>(
    type: T,
    handler: (event: NemoraCodeEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory })
    })
  }

  return {
    subscribe,
    on,
  }
}
