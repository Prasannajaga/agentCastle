import { invoke } from "@tauri-apps/api/core";

export type AgentStatus =
  | "idle"
  | "initializing"
  | "ready"
  | "running"
  | "failed"
  | "completed"
  | "cancelled";

export type RunStatus = "running" | "completed" | "failed" | "cancelled";
export type SandboxProviderName = "docker" | "podman";

export type CreatePromptPayload =
  | { type: "inline"; value: string }
  | { type: "file"; path: string };

export type CreateAgentPayload = {
  name: string;
  target_repo_path: string;
  sandbox_provider: SandboxProviderName;
  model: string;
  agent_provider?: string;
  prompt: CreatePromptPayload;
  max_iterations: number;
  branch?: string | null;
};

export type AgentPrompt = {
  type: "file";
  path: string;
  source_path?: string | null;
};

export type AgentConfig = {
  id: string;
  name: string;
  directory: string;
  target_repo_path: string;
  sandbox_provider: SandboxProviderName;
  model: string;
  agent_provider: string;
  prompt: AgentPrompt;
  max_iterations: number;
  branch: string;
  status: AgentStatus;
  latest_run_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentSummary = {
  id: string;
  name: string;
  directory: string;
  status: AgentStatus;
  latest_run_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type RunRecord = {
  id: string;
  agent_id: string;
  status: RunStatus;
  started_at: string;
  ended_at?: string | null;
  target_repo_path: string;
  branch: string;
  worktree_path?: string | null;
  model: string;
  agent_provider: string;
  sandbox_provider: SandboxProviderName;
  max_iterations: number;
  prompt_file: string;
  stdout_log: string;
  stderr_log: string;
  sandcastle_log: string;
  changes_patch: string;
  changed_files: string;
  commits_file: string;
  docker_metrics_file: string;
  error?: string | null;
  warning?: string | null;
};

export type AgentDetails = {
  agent: AgentConfig;
  latest_run?: RunRecord | null;
};

export type ChangedFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export type ChangedFiles = {
  files: ChangedFile[];
};

export type CommitInfo = {
  sha: string;
  summary?: string | null;
};

export type RunDetails = {
  run: RunRecord;
  changed_files: ChangedFiles;
  commits: CommitInfo[];
  stdout_log_available: boolean;
  stderr_log_available: boolean;
  sandcastle_log_available: boolean;
  patch_available: boolean;
};

export type RunLogs = {
  stdout: string;
  stderr: string;
  sandcastle: string;
};

export type ContainerMetric = {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  status?: string | null;
  cpu_percent?: string | null;
  memory_usage?: string | null;
  memory_limit?: string | null;
  memory_percent?: string | null;
  network_io?: string | null;
  block_io?: string | null;
};

export type DockerMetricsPayload = {
  agent_id: string;
  run_id: string;
  timestamp: string;
  provider: string;
  docker_available: boolean;
  daemon_running: boolean;
  containers: ContainerMetric[];
  unavailable_reason?: string | null;
};

export type ProcessMetricsPayload = {
  agent_id: string;
  run_id: string;
  timestamp: string;
  process_running: boolean;
  pid?: number | null;
};

export type LogEventPayload = {
  agent_id: string;
  run_id: string;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
};

export type StatusChangedPayload = {
  agent_id: string;
  run_id?: string | null;
  status: AgentStatus;
  timestamp: string;
};

export type RunEventPayload = {
  agent_id: string;
  run_id: string;
  status?: RunStatus;
  error?: string | null;
  warning?: string | null;
  started_at?: string;
  ended_at?: string;
};

export type CreatedEventPayload = {
  agent_id: string;
  agent: AgentDetails;
};

export type JobStarted = {
  agent_id: string;
  run_id: string;
};

export const agentApi = {
  listAgents: () => invoke<AgentSummary[]>("list_agents"),
  getAgent: (agentId: string) => invoke<AgentDetails>("get_agent", { agentId }),
  createAgent: (payload: CreateAgentPayload) =>
    invoke<AgentDetails>("create_agent", { payload }),
  runAgent: (agentId: string) => invoke<JobStarted>("run_agent", { agentId }),
  stopAgent: (agentId: string) => invoke<void>("stop_agent", { agentId }),
  deleteAgent: (agentId: string) => invoke<void>("delete_agent", { agentId }),
  getAgentRuns: (agentId: string) =>
    invoke<RunRecord[]>("get_agent_runs", { agentId }),
  getRunDetails: (agentId: string, runId: string) =>
    invoke<RunDetails>("get_run_details", { agentId, runId }),
  getRunPatch: (agentId: string, runId: string) =>
    invoke<string>("get_run_patch", { agentId, runId }),
  getRunLogs: (agentId: string, runId: string) =>
    invoke<RunLogs>("get_run_logs", { agentId, runId }),
  getLatestMetrics: (agentId: string, runId?: string | null) =>
    invoke<DockerMetricsPayload | null>("get_latest_metrics", { agentId, runId }),
  openAgentDirectory: (agentId: string) =>
    invoke<void>("open_agent_directory", { agentId }),
  openRunDirectory: (agentId: string, runId: string) =>
    invoke<void>("open_run_directory", { agentId, runId }),
};

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
