import type { EventApi } from "@nemoracode/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
