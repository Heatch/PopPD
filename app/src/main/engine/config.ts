import path from "node:path"
import type { McpServerSetting } from "../../shared/types"

export interface EngineConfigInput {
  model: string
  rulesPath: string
  pluginPath: string
  allowMcp: boolean
  mcpServers?: Record<string, McpServerSetting>
}

export interface EngineConfig {
  $schema: string
  model: string
  default_agent: string
  instructions: string[]
  plugins: Array<{ package: string }>
  agents: Record<string, unknown>
  permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
  policies: Array<{ action: string; resource: string; effect: "allow" | "deny" }>
  mcp?: { servers: Record<string, unknown> }
}

/**
 * Builds the OpenCode config PopPD owns. Instruction and plugin paths MUST be
 * absolute: relative instruction paths resolve against the session workspace and
 * are dropped silently (see spike/evidence/EVIDENCE.md).
 */
export function buildEngineConfig(input: EngineConfigInput): EngineConfig {
  if (!path.isAbsolute(input.rulesPath)) throw new Error("rulesPath must be absolute")
  if (!path.isAbsolute(input.pluginPath)) throw new Error("pluginPath must be absolute")
  if (!/^[^/]+\/[^/]+$/.test(input.model)) throw new Error(`model must be provider/model, got ${input.model}`)

  const servers: Record<string, unknown> = {}
  for (const [name, server] of Object.entries(input.mcpServers ?? {})) {
    if (!server.enabled) continue
    servers[name] = server.url
      ? { type: "remote", url: server.url }
      : { type: "local", command: server.command ?? [] }
  }

  const config: EngineConfig = {
    $schema: "https://opencode.ai/config.json",
    model: input.model,
    default_agent: "pop",
    instructions: [input.rulesPath],
    plugins: [{ package: input.pluginPath }],
    agents: {
      plan: { disabled: true },
      build: { hidden: true },
      pop: {
        mode: "primary",
        description: "PopPD: turns everyday requests into finished, openable results",
        color: "#c05f3c",
      },
    },
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      // Guardrails: the agent may do anything inside the workspace, nothing outside it.
      { action: "external_directory", resource: "*", effect: "deny" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "read", resource: "*.env.*", effect: "deny" },
      { action: "read", resource: "*id_rsa*", effect: "deny" },
      { action: "read", resource: "*credentials*", effect: "deny" },
      { action: "read", resource: "*auth.json", effect: "deny" },
      { action: "shell", resource: "rm -rf /*", effect: "deny" },
      { action: "shell", resource: "rm -rf ~*", effect: "deny" },
      { action: "shell", resource: "shutdown *", effect: "deny" },
      { action: "shell", resource: "format *", effect: "deny" },
    ],
    policies: input.allowMcp ? [] : [{ action: "mcp.use", resource: "*", effect: "deny" }],
  }

  if (input.allowMcp && Object.keys(servers).length > 0) {
    config.mcp = { servers }
  }

  return config
}
