/**
 * Immutable configuration for agent-related settings.
 * All agent form defaults, provider options, and status mappings reside here
 * to satisfy strict MVC separation rules.
 */

export type SandboxOption = { value: string; label: string };
export type ProviderOption = { value: string; label: string };

export interface AgentsConfig {
  readonly sandboxProviders: readonly SandboxOption[];
  readonly agentProviders: readonly ProviderOption[];
  readonly defaultModel: string;
  readonly defaultMaxIterations: number;
  readonly defaultSandboxProvider: string;
  readonly defaultAgentProvider: string;
  readonly statusColors: Readonly<Record<string, { bg: string; text: string; dot: string }>>;
}

export const AGENTS_CONFIG: Readonly<AgentsConfig> = Object.freeze({
  sandboxProviders: Object.freeze([
    { value: "docker", label: "Docker" },
    { value: "podman", label: "Podman" },
  ]),
  agentProviders: Object.freeze([
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex" },
    { value: "opencode", label: "OpenCode" },
    { value: "pi", label: "Pi" },
  ]),
  defaultModel: "claude-opus-4-6",
  defaultMaxIterations: 1,
  defaultSandboxProvider: "docker",
  defaultAgentProvider: "claude-code",
  statusColors: Object.freeze({
    ready: { bg: "bg-emerald-950/40", text: "text-emerald-400", dot: "bg-emerald-500" },
    running: { bg: "bg-sky-950/40", text: "text-sky-400", dot: "bg-sky-500" },
    initializing: { bg: "bg-amber-950/40", text: "text-amber-400", dot: "bg-amber-500" },
    completed: { bg: "bg-emerald-950/40", text: "text-emerald-400", dot: "bg-emerald-500" },
    failed: { bg: "bg-red-950/40", text: "text-red-400", dot: "bg-red-500" },
    cancelled: { bg: "bg-zinc-800/40", text: "text-zinc-400", dot: "bg-zinc-500" },
    idle: { bg: "bg-zinc-800/40", text: "text-zinc-500", dot: "bg-zinc-600" },
  }),
});
