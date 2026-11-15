#!/usr/bin/env node
// Static verification of a delivered workspace: inventory, launcher correctness,
// and basic HTML sanity. Prints JSON. Use a browser check afterwards for the
// "does it actually render" question.
import fs from "node:fs"
import path from "node:path"

const dir = process.argv[2]
if (!dir) {
  console.error("usage: node verify.mjs <workspace>")
  process.exit(1)
}

function walk(base) {
  const out = []
  const stack = [base]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else out.push(full)
    }
  }
  return out
}

const files = walk(dir).map((file) => ({
  path: path.relative(dir, file).replaceAll("\\", "/"),
  bytes: fs.statSync(file).size,
}))

const launcherName = files.find((f) => /^open this\.(bat|cmd|command)$/i.test(f.path))?.path ?? null
const launcherText = launcherName ? fs.readFileSync(path.join(dir, launcherName), "utf8") : null

const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path))
const mainHtml = htmlFiles.sort((a, b) => {
  const score = (p) => (/(^|\/)index\.html?$/i.test(p) ? 3 : /pomodoro|app|main/i.test(p) ? 2 : 1)
  return score(b.path) - score(a.path)
})[0]
const html = mainHtml ? fs.readFileSync(path.join(dir, mainHtml.path), "utf8") : null

const launcherTargetRaw = launcherText
  ? (launcherText.match(/"([^"]+\.html?)"/i)?.[1] ??
    launcherText.match(/start\s+"?"?\s*([^\s"]+\.html?)/i)?.[1] ??
    null)
  : null
const launcherTarget = launcherTargetRaw ? launcherTargetRaw.replace(/^%~dp0/i, "").replaceAll("\\", "/") : null

const result = {
  dir,
  files,
  launcher: launcherName
    ? {
        name: launcherName,
        text: launcherText,
        targetsExistingFile: launcherTarget
          ? files.some((f) => f.path.toLowerCase() === launcherTarget.toLowerCase())
          : null,
        target: launcherTarget,
      }
    : null,
  html: mainHtml
    ? {
        path: mainHtml.path,
        bytes: mainHtml.bytes,
        hasDoctype: /<!doctype html>/i.test(html),
        hasViewport: /name=["']viewport["']/i.test(html),
        scriptTags: (html.match(/<script/gi) ?? []).length,
        styleTags: (html.match(/<style/gi) ?? []).length,
        inlineSvg: /<svg/i.test(html),
        hasTimer: /setInterval|requestAnimationFrame/i.test(html),
        hasStorage: /localStorage/i.test(html),
      }
    : null,
}

console.log(JSON.stringify(result, null, 2))
