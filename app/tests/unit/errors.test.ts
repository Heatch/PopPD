import { describe, expect, it } from "vitest"
import { friendlyError } from "../../src/shared/errors"

describe("friendly errors", () => {
  it("maps auth failures to the key setting", () => {
    expect(friendlyError("401 Unauthorized: invalid api key")).toMatch(/key may have expired/i)
    expect(friendlyError("403 forbidden")).toMatch(/key may have expired/i)
  })

  it("maps rate limits", () => {
    expect(friendlyError("429 Too Many Requests")).toMatch(/too much right now/i)
  })

  it("maps network problems", () => {
    expect(friendlyError("fetch failed: ECONNRESET")).toMatch(/connection dropped/i)
    expect(friendlyError("ETIMEDOUT")).toMatch(/connection dropped/i)
  })

  it("maps disk and memory problems", () => {
    expect(friendlyError("ENOSPC: no space left")).toMatch(/enough space/i)
    expect(friendlyError("out of memory")).toMatch(/more memory/i)
  })

  it("falls back to a safe generic message", () => {
    expect(friendlyError(undefined)).toMatch(/files are safe/i)
    expect(friendlyError("mystery")).toMatch(/files are safe/i)
  })

  it("never leaks developer words", () => {
    for (const raw of ["401", "429", "ECONNRESET", "ENOSPC", "oom", undefined]) {
      expect(friendlyError(raw)).not.toMatch(/npm|terminal|command line|stack/i)
    }
  })
})
