import type { EventApi } from "@nemoracode/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
