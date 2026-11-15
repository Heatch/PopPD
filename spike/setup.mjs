#!/usr/bin/env node
// OpenCode resolves `instructions` relative to the session workspace, not to this
// config file, and drops a missing file silently. This script writes the absolute
// path so the PopPD persona actually loads.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(here, "opencode.jsonc")
const rulesPath = path.join(here, "instructions", "popd-rules.md")

if (!fs.existsSync(rulesPath)) {
  console.error(`missing constitution: ${rulesPath}`)
  process.exit(1)
}

const absolute = rulesPath.replaceAll("\\", "/")
const config = fs.readFileSync(configPath, "utf8")
const next = config.replace(/"instructions":\s*\[[^\]]*\]/, `"instructions": ["${absolute}"]`)

if (next === config && !config.includes(absolute)) {
  console.error("could not find an instructions entry in opencode.jsonc")
  process.exit(1)
}

fs.writeFileSync(configPath, next)
console.log(`instructions -> ${absolute}`)
