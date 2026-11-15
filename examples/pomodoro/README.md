# Example: pomodoro timer

This is a **real artifact**, produced end to end by the spike agent on 2026-11-15,
with `opencode-go/deepseek-v4.1-flash`, in about 8.8 minutes for roughly two cents.

It is exactly what the model wrote, apart from the launcher (created by the agent too).

- `index.html` — the whole app: focus/break ring, chimes, a daily "stretches" counter
  persisted in `localStorage`, keyboard shortcuts, responsive layout.
- `Open this.bat` — what the person double-clicks. It opens `index.html` in the
  default browser.

To try it: double-click `Open this.bat` (Windows), or open `index.html` directly.

The run that produced it: `spike/runs/pomodoro-2026-11-15T18-13-34-311Z/` in the
original workspace (not committed — `runs/` is gitignored). The report is in
[`spike/evidence/EVIDENCE.md`](../../spike/evidence/EVIDENCE.md).
