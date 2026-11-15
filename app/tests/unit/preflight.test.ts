import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { preflight } from "../../src/main/guardrails/preflight"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-preflight-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("preflight", () => {
  it("warns when free space is low", () => {
    const result = preflight(tempDir(), { free: () => 500 * 1024 * 1024 })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/almost full/i)
  })

  it("stays quiet with plenty of space", () => {
    const result = preflight(tempDir(), { free: () => 50 * 1024 * 1024 * 1024 })
    expect(result.warnings).toEqual([])
  })

  it("ignores an unknown free-space reading", () => {
    expect(preflight(tempDir(), { free: () => null }).warnings).toEqual([])
  })
})
