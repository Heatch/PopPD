import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("a run in progress can be stopped", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-stop-"))
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
    await expect(page.getByRole("heading", { name: "What's on your mind?" })).toBeVisible()

    await page.getByPlaceholder(/Ask me anything/).fill("Make me a shopping list")
    await page.getByRole("button", { name: "Send" }).click()

    const stop = page.getByRole("button", { name: "Stop" })
    await expect(stop).toBeVisible({ timeout: 10_000 })
    await stop.click()

    await expect(page.getByText("Stopped. Ask again whenever you're ready.")).toBeVisible()
    await expect(page.locator(".composer-status")).toHaveCount(0)
    await expect(page.locator(".run-dot")).toHaveCount(0)
    await expect(page.getByPlaceholder("Ask for a change…")).toBeVisible()
    expect(
      await page
        .getByPlaceholder("Ask for a change…")
        .evaluate((element) => getComputedStyle(element).textAlign),
    ).toBe("center")
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
