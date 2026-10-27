import { describe, expect, test } from "bun:test"
import { catalogIdentity } from "./catalog-identity"

describe("stats catalog identity", () => {
  test("resolves NemoraCode offerings to canonical labs", () => {
    const identity = catalogIdentity({
      models: { "meituan/longcat-2.5-preview": {} },
      providers: {
        nemoracode: { models: { "longcat-2.5-preview-free": { canonical_model_id: "meituan/longcat-2.5-preview" } } },
        "nemoracode-go": {
          models: { "longcat-2.5-preview-free": { canonical_model_id: "meituan/longcat-2.5-preview" } },
        },
      },
    })

    expect(identity.offerings.get("nemoracode/longcat-2.5-preview-free")).toBe("meituan")
    expect(identity.offerings.get("nemoracode-go/longcat-2.5-preview-free")).toBe("meituan")
    expect(identity.models.get("longcat-2.5-preview")).toBe("meituan")
  })

  test("does not guess a lab for a name shared by different canonical models", () => {
    const identity = catalogIdentity({
      models: { "lab-a/model": {}, "lab-b/model": {} },
      providers: {
        nemoracode: { models: { "model-free": { canonical_model_id: "lab-a/model" } } },
        "nemoracode-go": { models: { model: { canonical_model_id: "lab-b/model" } } },
      },
    })

    expect(identity.offerings.get("nemoracode/model-free")).toBe("lab-a")
    expect(identity.offerings.get("nemoracode-go/model")).toBe("lab-b")
    expect(identity.models.has("model")).toBe(false)
  })

  test("accepts provider IDs that are already canonical catalog IDs", () => {
    const identity = catalogIdentity({
      models: { "nemoracode/direct-model": {} },
      providers: { nemoracode: { models: { "direct-model": {} } } },
    })

    expect(identity.offerings.get("nemoracode/direct-model")).toBe("nemoracode")
    expect(identity.models.get("direct-model")).toBe("nemoracode")
  })

  test("rejects a catalog without published canonical identities", () => {
    expect(() => catalogIdentity({ models: {}, providers: { nemoracode: { models: { model: {} } } } })).toThrow(
      "Model catalog has no canonical NemoraCode offerings",
    )
  })
})
