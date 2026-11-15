import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readJson, writeJson } from "../../src/main/storage"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-storage-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("crash-safe storage", () => {
  it("round-trips JSON", () => {
    const file = path.join(tempDir(), "index.json")
    writeJson(file, { hello: "world" })
    expect(readJson(file, {})).toEqual({ hello: "world" })
  })

  it("keeps a backup and restores it when the main file is corrupt", () => {
    const file = path.join(tempDir(), "index.json")
    writeJson(file, { version: 1 })
    writeJson(file, { version: 2 })
    fs.writeFileSync(file, "{not json")
    expect(readJson(file, {})).toEqual({ version: 1 })
  })

  it("returns the fallback when both copies are missing", () => {
    expect(readJson(path.join(tempDir(), "missing.json"), { ok: true })).toEqual({ ok: true })
  })

  it("does not leave a temp file behind", () => {
    const dir = tempDir()
    const file = path.join(dir, "index.json")
    writeJson(file, [1, 2, 3])
    expect(fs.readdirSync(dir).sort()).toEqual(["index.json"])
  })
})
