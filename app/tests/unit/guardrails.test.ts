import { describe, expect, it } from "vitest"
import { lint, sanitize } from "../../src/main/guardrails/lint"

describe("guardrail lint", () => {
  it("flags developer-speak", () => {
    const result = lint("Run npm run dev to see it.")
    expect(result.ok).toBe(false)
    expect(result.hard.length).toBeGreaterThan(0)
  })

  it("passes plain language", () => {
    const result = lint("Your timer is ready. Double-click Open this.bat to see it.")
    expect(result.ok).toBe(true)
  })

  it("strips offending lines and code fences", () => {
    const input = [
      "Here is your app.",
      "Run `npm install` and then `npm run dev`.",
      "```bash",
      "cd my-app && npm start",
      "```",
      "Open this.bat when you're ready.",
    ].join("\n")
    const cleaned = sanitize(input)
    expect(cleaned.changed).toBe(true)
    expect(cleaned.text).not.toMatch(/npm|cd my-app|```/)
    expect(cleaned.text).toContain("Open this.bat")
  })

  it("removes markdown emphasis so no stray asterisks arrive", () => {
    const cleaned = sanitize("Double-click **Open this.bat** when it's ready.")
    expect(cleaned.text).toBe("Double-click Open this.bat when it's ready.")
  })

  it("keeps clean text untouched", () => {
    const input = "Your spreadsheet is ready. Open this.bat to see it."
    const cleaned = sanitize(input)
    expect(cleaned.changed).toBe(false)
    expect(cleaned.text).toBe(input)
  })

  it("falls back to a plain completion sentence when everything is stripped", () => {
    const cleaned = sanitize("Run npm install")
    expect(cleaned.text).toBe("Done — your result is ready.")
  })
})
