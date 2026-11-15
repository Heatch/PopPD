import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildEngineConfig } from "../../src/main/engine/config"

const base = {
  model: "opencode-go/deepseek-v4.1-flash",
  rulesPath: "C:/PopPD/resources/popd-rules.md",
  pluginPath: "C:/PopPD/resources/popd-plugin",
  allowMcp: false,
}

describe("engine config", () => {
  it("pins the model and the PopPD agent", () => {
    const config = buildEngineConfig(base)
    expect(config.model).toBe("opencode-go/deepseek-v4.1-flash")
    expect(config.default_agent).toBe("pop")
    expect(config.agents.pop).toMatchObject({ mode: "primary" })
  })

  it("removes the planning agent and hides build", () => {
    const config = buildEngineConfig(base)
    expect(config.agents.plan).toEqual({ disabled: true })
    expect(config.agents.build).toEqual({ hidden: true })
  })

  it("uses absolute instruction and plugin paths (the silent-failure trap)", () => {
    const config = buildEngineConfig(base)
    expect(path.isAbsolute(config.instructions[0])).toBe(true)
    expect(path.isAbsolute(config.plugins[0].package)).toBe(true)
  })

  it("refuses relative instruction paths", () => {
    expect(() => buildEngineConfig({ ...base, rulesPath: "./popd-rules.md" })).toThrow(/absolute/)
  })

  it("allows everything so runs never wait for approval", () => {
    const config = buildEngineConfig(base)
    expect(config.permissions[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
    expect(config.permissions.some((rule) => rule.effect === "ask")).toBe(false)
  })

  it("blocks MCP by default and includes servers only when allowed", () => {
    const blocked = buildEngineConfig(base)
    expect(blocked.policies).toContainEqual({ action: "mcp.use", resource: "*", effect: "deny" })
    expect(blocked.mcp).toBeUndefined()

    const allowed = buildEngineConfig({
      ...base,
      allowMcp: true,
      mcpServers: { docs: { enabled: true, url: "https://example.test/mcp" } },
    })
    expect(allowed.policies).toEqual([])
    expect(allowed.mcp?.servers.docs).toEqual({ type: "remote", url: "https://example.test/mcp" })
  })

  it("denies writes outside the workspace and reads of secrets", () => {
    const config = buildEngineConfig(base)
    expect(config.permissions).toContainEqual({ action: "external_directory", resource: "*", effect: "deny" })
    expect(config.permissions).toContainEqual({ action: "read", resource: "*.env", effect: "deny" })
    expect(config.permissions).toContainEqual({ action: "read", resource: "*id_rsa*", effect: "deny" })
  })
})
