import { _electron as electron, expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const executable = path.join(process.cwd(), "dist", "win-unpacked", "PopPD.exe")

test.skip(!fs.existsSync(executable), "packaged build missing (run: npm run package)")

test("packaged app boots into onboarding", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "popd-pkg-"))
  const app = await electron.launch({
    executablePath: executable,
    env: {
      ...process.env,
      POPD_MOCK: "1",
      POPD_NO_OPEN: "1",
      POPD_USER_DATA: path.join(tmp, "user"),
      POPD_DOCUMENTS: path.join(tmp, "docs"),
      POPD_WORKSPACE: path.join(tmp, "docs", "PopPD"),
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText("Hi. I'm PopPD.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Start making things" })).toBeVisible()
    await page.screenshot({ path: path.join(tmp, "packaged.png") })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
