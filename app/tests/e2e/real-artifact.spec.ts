import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { lint } from "../../src/main/guardrails/lint"

test.skip(process.env.POPD_REAL !== "1", "set POPD_REAL=1 to run against the real engine")

function newestWorkspace(root: string): string | null {
  try {
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return dirs[0] ?? null
  } catch {
    return null
  }
}

test("real engine: a plain request becomes an openable artifact", async () => {
  test.setTimeout(420_000)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-accept-"))
  const userData = path.join(tmp, "user")
  const documents = path.join(tmp, "docs")
  const workspaceRoot = path.join(documents, "PopPD")
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify(
      {
        onboarded: true,
        model: process.env.POPD_MODEL ?? "opencode-go/deepseek-v4.1-flash",
        workspaceRoot,
        autoOpen: false,
        notifications: false,
        allowMcp: false,
        mcpServers: {},
      },
      null,
      2,
    ),
  )

  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      POPD_NO_OPEN: "1",
      POPD_USER_DATA: userData,
      POPD_DOCUMENTS: documents,
      POPD_WORKSPACE: workspaceRoot,
    },
  })

  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("heading", { name: "What should we make today?" })).toBeVisible({
      timeout: 30_000,
    })

    await page
      .getByPlaceholder(/A timer/)
      .fill(
        "Make a single web page that says Hello from PopPD with a little style. Create Open this.bat, then use deliver_artifact for the page.",
      )
    await page.getByRole("button", { name: "Make it →" }).click()

    await expect(page.getByText("Your result")).toBeVisible({ timeout: 360_000 })

    const workspace = newestWorkspace(workspaceRoot)
    expect(workspace).toBeTruthy()
    const files = fs.readdirSync(workspace!)
    expect(files.some((file) => /\.html?$/i.test(file))).toBe(true)
    expect(files).toContain("Open this.bat")

    const message = await page.locator(".msg-assistant").last().innerText()
    const result = lint(message)
    expect(result.ok).toBe(true)

    // The same artifact shows up in Your stuff.
    await page.getByRole("button", { name: "← Back" }).click()
    await page.getByRole("button", { name: "Your stuff" }).click()
    await expect(page.getByText(/\.html?$/).first()).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: path.join(tmp, "acceptance.png") })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
