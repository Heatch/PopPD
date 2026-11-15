import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { listArtifacts } from "../../src/main/delivery/artifacts"
import { slugify, ensureWorkspace } from "../../src/main/delivery/workspace"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-artifacts-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("artifacts", () => {
  it("hides scaffolding, launchers and dotfiles", () => {
    const dir = tempDir()
    for (const name of ["index.html", "photo.png", "_test.mjs", "Open this.bat", ".secret"]) {
      fs.writeFileSync(path.join(dir, name), "x")
    }
    fs.mkdirSync(path.join(dir, "_work"))
    fs.writeFileSync(path.join(dir, "_work", "hidden.html"), "x")

    const artifacts = listArtifacts(dir)
    expect(artifacts.map((artifact) => artifact.name)).toEqual(["index.html", "photo.png"])
    expect(artifacts[0].kind).toBe("web")
    expect(artifacts[1].kind).toBe("image")
  })

  it("sorts the web artifact before the rest", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "data.xlsx"), "x")
    fs.writeFileSync(path.join(dir, "app.html"), "x")
    expect(listArtifacts(dir)[0].kind).toBe("web")
  })
})

describe("workspace names", () => {
  it("slugifies titles safely", () => {
    expect(slugify("Make me a Pomodoro Timer!")).toBe("make-me-a-pomodoro-timer")
    expect(slugify("  ...  ")).toBe("new-idea")
    expect(slugify("Über café")).toBe("uber-cafe")
  })

  it("never reuses a folder with content", () => {
    const root = tempDir()
    const first = ensureWorkspace(root, "timer")
    fs.writeFileSync(path.join(first, "index.html"), "x")
    const second = ensureWorkspace(root, "timer")
    expect(second).not.toBe(first)
    expect(path.basename(second)).toBe("timer-2")
  })

  it("reuses an empty folder", () => {
    const root = tempDir()
    const first = ensureWorkspace(root, "timer")
    expect(ensureWorkspace(root, "timer")).toBe(first)
  })
})
