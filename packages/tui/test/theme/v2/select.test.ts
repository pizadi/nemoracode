import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@nemoracode/theme/tui"
import { getNemoraCodeTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getNemoraCodeTheme(), "light")
  const dark = selectTheme(getNemoraCodeTheme(), "dark")
  expect(selectTheme(getNemoraCodeTheme())).toEqual(light)
  expect(light.hue).toEqual(getNemoraCodeTheme().light.hue)
  expect(dark.text).toEqual(getNemoraCodeTheme().base.text)
  expect(dark.hue).toEqual(getNemoraCodeTheme().dark.hue)
  expect(selectThemeMode(getNemoraCodeTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getNemoraCodeTheme().base, light: getNemoraCodeTheme().light } as const
  const darkOnly = { base: getNemoraCodeTheme().base, dark: getNemoraCodeTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getNemoraCodeTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getNemoraCodeTheme(), "dark"), mode: "dark" })
})
