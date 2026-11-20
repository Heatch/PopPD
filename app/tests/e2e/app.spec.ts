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

    await expect(page.getByRole("heading", { name: "What's on your mind?" })).toBeVisible()

    // Ask for something.
    await page.getByPlaceholder(/Ask me anything/).fill("Make me a pomodoro timer")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.locator(".msg-user", { hasText: "Make me a pomodoro timer" })).toBeVisible()
    await expect(page.getByText("Your result")).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(".msg-user")).toHaveCount(1)
    await expect(page.locator(".msg-assistant-block").getByText("PopPD")).toBeVisible()
    await expect(page.getByText("index.html").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Open" }).first()).toBeVisible()

    // A chat can keep going: a second turn must not borrow the first one's outcome.
    await page.getByPlaceholder("Ask for a change…").fill("Make the colours a bit warmer")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.locator(".msg-user")).toHaveCount(2)
    await expect(page.locator(".msg-assistant-block")).toHaveCount(2, { timeout: 40_000 })
    await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible()

    // Rename the chat from its header.
    await page.getByRole("button", { name: "Rename chat" }).click()
    await page.locator(".chat-header input").fill("Focus timer")
    await page.locator(".chat-header input").press("Enter")
    await expect(page.locator(".chat-title")).toHaveText("Focus timer")

    // Your stuff: the same result appears in the library.
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await page.getByRole("button", { name: "Your stuff", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Your stuff" })).toBeVisible()
    await expect(page.getByText("index.html").first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(".library-card .thumb img")).toHaveCount(1, { timeout: 30_000 })
    await page.screenshot({ path: path.join(tmp, "library.png") })

    // Reopening a chat from the sidebar restores its messages and result card.
    await page.locator(".side-chat", { hasText: "Focus timer" }).click()
    await expect(page.getByText("Your result")).toBeVisible()
    await expect(page.getByText("index.html").first()).toBeVisible()
    await expect(page.locator(".msg-user", { hasText: "Make me a pomodoro timer" })).toBeVisible()

    // Settings are hidden: Shift+click the wordmark (or Ctrl+Shift+,).
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await page.getByRole("button", { name: "PopPD home" }).click({ modifiers: ["Shift"] })
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()

    // Theme can be forced, and dark mode applies immediately.
    await page.getByRole("button", { name: "Dark" }).click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(background).toBe("rgb(25, 23, 21)")

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

    // Chat settings live in the sidebar: rename from the "…" menu.
    await page.getByRole("button", { name: "← Back" }).click()
    expect(
      await page.locator(".side-chats").evaluate((element) => getComputedStyle(element).scrollbarWidth),
    ).toBe("none")

    await page.getByRole("button", { name: "Options for Focus timer" }).click()
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible()
    await page.getByRole("menuitem", { name: "Rename" }).click()
    await page.locator(".side-rename").fill("Focus timer v2")
    await page.locator(".side-rename").press("Enter")
    await expect(page.locator(".side-chat", { hasText: "Focus timer v2" })).toBeVisible()

    // Pinning keeps a chat at the top of the sidebar.
    await page.getByRole("button", { name: "Options for Focus timer v2" }).click()
    await page.getByRole("menuitem", { name: "Pin to top" }).click()
    const sidebar = page.locator(".side-chats")
    await expect(sidebar.locator(".side-section").first()).toHaveText("Pinned")
    await expect(sidebar.locator(".side-chat").first()).toContainText("Focus timer v2")
    await page.getByRole("button", { name: "Options for Focus timer v2" }).click()
    await expect(page.getByRole("menuitem", { name: "Unpin" })).toBeVisible()
    await page.keyboard.press("Escape")

    // Right-clicking a chat opens the same menu.
    await page.locator(".side-chat", { hasText: "Focus timer v2" }).click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0)

    // Archive can be taken back from the toast.
    await page.getByRole("button", { name: "Options for Focus timer v2" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.locator(".side-chat", { hasText: "Focus timer" })).toHaveCount(0)
    await expect(page.getByText(/moved to PopPD Archive/)).toBeVisible()
    expect(fs.existsSync(path.join(tmp, "docs", "PopPD Archive"))).toBe(true)
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(page.locator(".side-chat", { hasText: "Focus timer v2" })).toBeVisible()

    // Archive again, this time for good.
    await page.getByRole("button", { name: "Options for Focus timer v2" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.locator(".side-chat", { hasText: "Focus timer" })).toHaveCount(0)

    // Delete asks in the app, then removes the chat.
    await page.evaluate(() => window.popd.createChat("Throwaway"))
    await expect(page.locator(".side-chat", { hasText: "Throwaway" })).toBeVisible()
    await page.getByRole("button", { name: "Options for Throwaway" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete chat" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Delete" }).click()
    await expect(page.locator(".side-chat", { hasText: "Throwaway" })).toHaveCount(0)

    // A long title still leaves the options button inside the sidebar.
    await page.evaluate(() => window.popd.createChat("A really long chat name that should be cut off cleanly"))
    const longRow = page.getByRole("button", { name: /Options for A really long chat/ })
    await expect(longRow).toBeVisible()
    const sidebarBox = (await page.locator(".sidebar").boundingBox())!
    const optionsBox = (await longRow.boundingBox())!
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
