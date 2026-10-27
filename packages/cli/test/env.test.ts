import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.NEMORACODE_PASSWORD
  const previousLegacyPassword = process.env.NEMORACODE_SERVER_PASSWORD
  const previousValue = process.env.NEMORACODE_SESSION_ENV_TEST
  process.env.NEMORACODE_PASSWORD = "password"
  process.env.NEMORACODE_SERVER_PASSWORD = "legacy"
  process.env.NEMORACODE_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.NEMORACODE_PASSWORD
  else process.env.NEMORACODE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.NEMORACODE_SERVER_PASSWORD
  else process.env.NEMORACODE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.NEMORACODE_SESSION_ENV_TEST
  else process.env.NEMORACODE_SESSION_ENV_TEST = previousValue

  expect(environment.NEMORACODE_PASSWORD).toBeUndefined()
  expect(environment.NEMORACODE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.NEMORACODE_SESSION_ENV_TEST).toBe("included")
})
