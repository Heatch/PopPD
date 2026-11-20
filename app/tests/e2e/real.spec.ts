import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test.skip(process.env.POPD_REAL !== "1", "set POPD_REAL=1 to run against the real engine")

test("real engine: ask who it is and see the PopPD answer", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-real-"))
  const userData = path.join(tmp, "user")
  const documents = path.join(tmp, "docs")
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(documents, { recursive: true })
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify(
      {
        onboarded: true,
        model: process.env.POPD_MODEL ?? "opencode-go/deepseek-v4.1-flash",
        workspaceRoot: path.join(documents, "PopPD"),
        autoOpen: false,
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
      POPD_WORKSPACE: path.join(documents, "PopPD"),
    },
  })

  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("heading", { name: "What's on your mind?" })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByPlaceholder(/Ask me anything/).fill("Who are you, and what do you do? Answer in one short sentence.")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.locator(".msg-assistant").filter({ hasText: /pop+d|friendly builder/i }).first()).toBeVisible({
      timeout: 180_000,
    })

    // A question is conversation, not a build: no result card, no launcher.
    await expect(page.getByRole("heading", { name: "Your result" })).toHaveCount(0)
    expect(await page.locator(".artifact").count()).toBe(0)

    const body = await page.locator("body").innerText()
    expect(body.toLowerCase()).not.toContain("opencode is")
    await page.screenshot({ path: path.join(tmp, "real.png") })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
