import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureLauncher, mainArtifactPath, sweepScaffolding } from "../../src/main/delivery/launcher"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-launcher-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("launcher guarantee", () => {
  it("writes Open this.bat pointing at index.html when the model forgot", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Hello</title>")
    const result = ensureLauncher(dir)
    expect(result?.auto).toBe(true)
    const bat = fs.readFileSync(path.join(dir, "Open this.bat"), "utf8")
    expect(bat).toContain('start "" "%~dp0index.html"')
  })

  it("keeps a launcher the model already wrote", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "app.html"), "<!doctype html>")
    const custom = '@echo off\r\nstart "" "%~dp0app.html"\r\n'
    fs.writeFileSync(path.join(dir, "Open this.bat"), custom)
    const result = ensureLauncher(dir)
    expect(result?.auto).toBe(false)
    expect(fs.readFileSync(path.join(dir, "Open this.bat"), "utf8")).toBe(custom)
  })

  it("does nothing when there is no HTML artifact", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello")
    expect(ensureLauncher(dir)).toBeNull()
  })

  it("prefers index.html as the thing to open", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "other.html"), "")
    fs.writeFileSync(path.join(dir, "index.html"), "")
    expect(path.basename(mainArtifactPath(dir)!)).toBe("index.html")
  })

  it("opens a non-web artifact with its default app", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "report.pdf"), "pdf")
    const result = ensureLauncher(dir)
    expect(result?.auto).toBe(true)
    expect(fs.readFileSync(path.join(dir, "Open this.bat"), "utf8")).toContain("%~dp0report.pdf")
  })

  it("honours the deliverable marker", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "index.html"), "")
    fs.writeFileSync(path.join(dir, "report.pdf"), "pdf")
    fs.writeFileSync(
      path.join(dir, ".popd-deliverable.json"),
      JSON.stringify({ path: path.join(dir, "report.pdf"), kind: "pdf" }),
    )
    expect(path.basename(mainArtifactPath(dir)!)).toBe("report.pdf")
  })

  it("sweeps scaffolding into _work", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "index.html"), "")
    fs.writeFileSync(path.join(dir, "_test.mjs"), "x")
    expect(sweepScaffolding(dir)).toBe(1)
    expect(fs.existsSync(path.join(dir, "_test.mjs"))).toBe(false)
    expect(fs.existsSync(path.join(dir, "_work", "_test.mjs"))).toBe(true)
  })
})
