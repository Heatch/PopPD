import { describe, expect, it } from "vitest"
import { waitForId } from "../../src/main/backend/wait"

describe("catalog wait", () => {
  it("returns as soon as the id appears", async () => {
    let calls = 0
    const found = await waitForId(
      async () => {
        calls++
        return calls >= 3 ? ["deepseek", "opencode-go"] : ["deepseek"]
      },
      "opencode-go",
      { timeoutMs: 2000, intervalMs: 10 },
    )
    expect(found).toBe(true)
    expect(calls).toBe(3)
  })

  it("gives up after the timeout", async () => {
    const found = await waitForId(async () => ["deepseek"], "opencode-go", { timeoutMs: 60, intervalMs: 10 })
    expect(found).toBe(false)
  })

  it("tolerates a failing catalog while it warms up", async () => {
    let calls = 0
    const found = await waitForId(
      async () => {
        calls++
        if (calls < 3) throw new Error("not ready")
        return ["opencode-go"]
      },
      "opencode-go",
      { timeoutMs: 2000, intervalMs: 10 },
    )
    expect(found).toBe(true)
  })
})
