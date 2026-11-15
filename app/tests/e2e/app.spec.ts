import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("onboarding → make something → library → settings", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-e2e-"))
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
    await page.waitForLoadState("domcontentloaded")

    // First run: one-time key setup.
    await expect(page.getByText("Hi. I'm PopPD.")).toBeVisible()
    await page.getByLabel("Your key").fill("test-key-1234567890")
    await page.getByRole("button", { name: "Start making things" }).click()

    await expect(page.getByRole("heading", { name: "What should we make today?" })).toBeVisible()

    // Ask for something.
    await page.getByPlaceholder(/A timer/).fill("Make me a pomodoro timer")
    await page.getByRole("button", { name: "Make it →" }).click()
    await expect(page.getByText("Make me a pomodoro timer").first()).toBeVisible()
    await expect(page.getByText("Your result")).toBeVisible({ timeout: 40_000 })
    await expect(page.getByText("index.html").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Open" }).first()).toBeVisible()

    // Your stuff: the same result appears in the library.
    await page.getByRole("button", { name: "← Back" }).click()
    await page.getByRole("button", { name: "Your stuff" }).click()
    await expect(page.getByRole("heading", { name: "Your stuff" })).toBeVisible()
    await expect(page.getByText("index.html").first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(".library-card .thumb img")).toHaveCount(1, { timeout: 30_000 })
    await page.screenshot({ path: path.join(tmp, "library.png") })

    // Back home, then settings.
    await page.getByRole("button", { name: "PopPD home" }).click()
    await page.getByRole("button", { name: "Settings" }).click()
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()

    // MCP server inventory (mock engine reports one).
    await expect(page.getByText("demo-tools")).toBeVisible()

    // Key check runs a tiny request through the engine.
    await page.getByRole("button", { name: "Check key" }).click()
    await expect(page.getByText("✓ Your key works.")).toBeVisible({ timeout: 20_000 })

    // Usage is computed from the session.
    await expect(page.getByText(/12\.4k in/)).toBeVisible()

    // Updates: check → download → ready.
    await page.getByRole("button", { name: "Check for updates" }).click()
    await expect(page.getByRole("button", { name: /Download v9\.9\.9/ })).toBeVisible()
    await page.getByRole("button", { name: /Download v9\.9\.9/ }).click()
    await expect(page.getByRole("button", { name: "Restart and install" })).toBeVisible()

    // Logs viewer works.
    await page.getByRole("button", { name: "Show logs" }).click()
    await expect(page.locator(".logs pre").first()).toBeVisible()

    await page.screenshot({ path: path.join(tmp, "settings.png") })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
