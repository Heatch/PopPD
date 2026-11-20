import { describe, expect, it } from "vitest"
import { elapsedText, friendlyLine, summarizeReasoning, toolsLine } from "../../src/main/engine/progress"

describe("friendly progress", () => {
  it("maps tools to plain language", () => {
    expect(friendlyLine("write")).toBe("Building it…")
    expect(friendlyLine("shell")).toBe("Running a quick check…")
    expect(friendlyLine("open_with_default_app")).toBe("Opening your result…")
    expect(friendlyLine(undefined)).toBe("Thinking it through…")
    expect(friendlyLine("something-new")).toBe("Working on it…")
  })

  it("uses the most recent meaningful tool", () => {
    expect(toolsLine(["write", "shell"])).toBe("Running a quick check…")
    expect(toolsLine(["write", "shell", "read"])).toBe("Looking over what I made…")
    expect(toolsLine(["write", "mystery"])).toBe("Building it…")
    expect(toolsLine([])).toBe("Thinking it through…")
  })

  it("formats elapsed time", () => {
    expect(elapsedText(8_000)).toBe("8s")
    expect(elapsedText(125_000)).toBe("2m 5s")
  })

  it("never leaks developer words", () => {
    for (const tool of ["write", "shell", "read", "webfetch", "open_with_default_app", undefined]) {
      expect(friendlyLine(tool)).not.toMatch(/npm|terminal|command|node|git/i)
    }
  })

  it("shows the tail of the model's reasoning, cleaned up", () => {
    expect(summarizeReasoning("")).toBe("")
    expect(summarizeReasoning("  Planning\n\n  the layout.  ")).toBe("Planning the layout.")
    expect(summarizeReasoning("Use `readFile` then\n```ts\nconst x = 1\n```\nwrite it")).toBe(
      "Use readFile then write it",
    )
    const long = "a".repeat(500)
    const short = summarizeReasoning(long)
    expect(short.length).toBeLessThanOrEqual(200)
    expect(short.startsWith("…")).toBe(true)
  })
})
