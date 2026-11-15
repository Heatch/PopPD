import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("closing the window mid-task keeps the task running", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-tray-"))
  const userData = path.join(tmp, "user")
  const documents = path.join(tmp, "docs")
  const workspaceRoot = path.join(documents, "PopPD")
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      onboarded: true,
      model: "opencode-go/deepseek-v4.1-flash",
      workspaceRoot,
      autoOpen: false,
      notifications: false,
      allowMcp: false,
      mcpServers: {},
    }),
  )

  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      POPD_MOCK: "1",
      POPD_MOCK_SPEED: "2",
      POPD_NO_OPEN: "1",
      POPD_USER_DATA: userData,
      POPD_DOCUMENTS: documents,
      POPD_WORKSPACE: workspaceRoot,
    },
  })

  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("heading", { name: "What should we make today?" })).toBeVisible()

    await page.getByPlaceholder(/A timer/).fill("Make me a pomodoro timer")
    await page.getByRole("button", { name: "Make it →" }).click()
    await expect(page.getByText("Getting started…")).toBeVisible({ timeout: 10_000 })

    // Close the window while it works: it should hide, not quit.
    await expect
      .poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), {
        timeout: 15_000,
      })
      .toContain("working")
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const visible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.isVisible() : null
    })
    expect(visible).toBe(false)

    // The run finishes in the background.
    await page.waitForFunction(() => document.body.innerText.includes("Your result"), null, {
      timeout: 60_000,
    })

    // Bring it back and confirm the result is there.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.show()
      win.focus()
    })
    await expect(page.getByText("Your result")).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
