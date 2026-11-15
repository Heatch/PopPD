import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

// Main and preload are bundled (CJS). @opencode/client is ESM-only, so it is
// bundled into the main chunk rather than externalized.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["electron", "@opencode/client"],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
})
