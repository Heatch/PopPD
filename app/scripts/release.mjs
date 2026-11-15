#!/usr/bin/env node
// One-command release: version, build the installer, tag, push, upload.
// Use --dry to see every step without touching anything.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const versionIndex = args.indexOf("--version")
const version = versionIndex >= 0 ? args[versionIndex + 1] : null

function run(command, argv) {
  console.log(`${dry ? "[dry] " : ""}$ ${command} ${argv.join(" ")}`)
  if (dry) return
  execFileSync(command, argv, { stdio: "inherit" })
}

if (version) run("npm", ["version", version, "--no-git-tag-version"])
run("node", ["scripts/prepare-engine.mjs"])
run("npm", ["run", "build"])
run("npx", ["electron-builder", "--win", "nsis", "--publish", "never"])

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
const releaseVersion = dry && version ? version : pkg.version
const installer = path.join("dist", `PopPD-Setup-${releaseVersion}.exe`)

if (!dry) {
  if (!fs.existsSync(installer)) {
    console.error(`missing installer: ${installer}`)
    process.exit(1)
  }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex")
  console.log(`installer: ${installer}`)
  console.log(`sha256:    ${sha}`)
}

run("git", ["add", "-A"])
run("git", ["commit", "-m", `release v${releaseVersion}`])
run("git", ["tag", `v${releaseVersion}`])
run("git", ["push", "origin", "HEAD", "--follow-tags"])

let hasGh = false
try {
  execFileSync("gh", ["--version"], { stdio: "ignore" })
  hasGh = true
} catch {
  hasGh = false
}

if (hasGh) {
  run("gh", [
    "release",
    "create",
    `v${releaseVersion}`,
    installer,
    `${installer}.blockmap`,
    "--title",
    `PopPD v${releaseVersion}`,
    "--notes",
    `PopPD ${releaseVersion}`,
  ])
} else {
  console.log(`
gh CLI not found. Publish manually:
  1. Open https://github.com/Heatch/PopPD/releases/new?tag=v${releaseVersion}
  2. Upload ${installer} and ${installer}.blockmap
  3. Publish (the in-app updater reads the latest release)
`)
}
