import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("an API-key request becomes a simple guided dialog", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-key-"))
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      POPD_MOCK: "1",
      POPD_MOCK_SPEED: "0.2",
      POPD_NO_OPEN: "1",
      POPD_USER_DATA: path.join(tmp, "user"),
      POPD_DOCUMENTS: path.join(tmp, "docs"),
      POPD_WORKSPACE: path.join(tmp, "docs", "PopPD"),
    },
  })

  try {
    const page = await app.firstWindow()
    await page.getByLabel("Your key").fill("test-key-1234567890")
    await page.getByRole("button", { name: "Start making things" }).click()
    await page.getByPlaceholder(/A timer/).fill("I need an api key for a weather service")
    await page.getByRole("button", { name: "Make it →" }).click()

    await expect(page.getByText("A key for demo-service")).toBeVisible({ timeout: 40_000 })
    await expect(page.getByRole("button", { name: "Open the page" })).toBeVisible()
    await page.getByLabel("Paste the key").fill("sk-test-123456789")
    await page.getByRole("button", { name: "Save key" }).click()
    await expect(page.getByText("Saved. Ask PopPD to carry on.")).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
