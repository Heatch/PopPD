import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const executable = path.join(process.cwd(), "dist", "win-unpacked", "PopPD.exe")

test.skip(process.env.POPD_REAL !== "1", "set POPD_REAL=1 to run against the real engine")
test.skip(!fs.existsSync(executable), "packaged build missing (run: npm run package)")

test("packaged app uses its bundled engine and answers as PopPD", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-pkg-real-"))
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
    executablePath: executable,
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
    await page.getByPlaceholder(/Ask me anything/).fill("Who are you? Answer in one short sentence.")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.locator(".msg-assistant").filter({ hasText: /pop+d|friendly builder/i }).first()).toBeVisible({
      timeout: 180_000,
    })
    await page.screenshot({ path: path.join(tmp, "packaged-real.png") })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
