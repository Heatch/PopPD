import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("PopPD rules", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "resources", "popd-rules.md"), "utf8")

  it("allows plain conversation without building anything", () => {
    expect(rules).toMatch(/Talking vs\. building/)
    expect(rules).toMatch(/do \*\*not\*\* create files/i)
    expect(rules).toMatch(/Never produce an artifact just to have something to show/i)
  })

  it("still guarantees a one-click launcher for real builds", () => {
    expect(rules).toMatch(/Open this\.bat/)
    expect(rules).toMatch(/deliver_artifact/)
  })

  it("keeps the nontechnical promises", () => {
    expect(rules).toMatch(/Never ask the user to run anything/i)
    expect(rules).toMatch(/Never expose the machinery/i)
  })
})
