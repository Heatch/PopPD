import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ChatSummary } from "../../src/shared/types"
import { Library } from "../../src/main/library"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-library-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function chat(workspace: string, id = "chat-1"): ChatSummary {
  return { id, title: "A thing", workspace, createdAt: 1, updatedAt: 10 }
}

describe("library", () => {
  it("indexes the main artifact and hides scaffolding", async () => {
    const root = tempDir()
    const workspace = path.join(root, "thing")
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html>")
    fs.writeFileSync(path.join(workspace, "_test.mjs"), "x")

    const calls: string[] = []
    const library = new Library({
      indexPath: path.join(root, "library.json"),
      thumbnailer: {
        async ensure(file) {
          calls.push(file)
          return path.join(root, "thumb.png")
        },
      },
    })

    const entries = await library.refresh([chat(workspace)])
    expect(entries).toHaveLength(1)
    expect(entries[0].main?.name).toBe("index.html")
    expect(entries[0].artifacts.map((artifact) => artifact.name)).toEqual(["index.html"])
    expect(entries[0].thumb).toBe(path.join(root, "thumb.png"))
    expect(calls).toHaveLength(1)
  })

  it("prefers the deliverable marker", async () => {
    const root = tempDir()
    const workspace = path.join(root, "thing")
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html>")
    fs.writeFileSync(path.join(workspace, "report.pdf"), "pdf")
    fs.writeFileSync(
      path.join(workspace, ".popd-deliverable.json"),
      JSON.stringify({ path: path.join(workspace, "report.pdf"), kind: "pdf" }),
    )

    const library = new Library({
      indexPath: path.join(root, "library.json"),
      thumbnailer: { async ensure() { return null } },
    })
    const entries = await library.refresh([chat(workspace)])
    expect(entries[0].main?.name).toBe("report.pdf")
  })

  it("persists entries and reloads them", async () => {
    const root = tempDir()
    const workspace = path.join(root, "thing")
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html>")
    const indexPath = path.join(root, "library.json")

    const first = new Library({
      indexPath,
      thumbnailer: { async ensure() { return null } },
    })
    await first.refresh([chat(workspace)])

    const second = new Library({
      indexPath,
      thumbnailer: { async ensure() { return null } },
    })
    expect(second.list()).toHaveLength(1)
    expect(second.list()[0].chatId).toBe("chat-1")
  })
})
