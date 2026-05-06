import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Activity, Bot, FileText, FolderOpen, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  agentApi,
  type AgentDetails,
  type AgentSummary,
  type CreateAgentPayload,
  type DockerMetricsPayload,
  getErrorMessage,
  type LogEventPayload,
  type RunDetails,
  type RunLogs,
  type RunRecord,
  type SandboxProviderName,
  type StatusChangedPayload,
} from "@/lib/agents";

const statusTone: Record<string, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  running: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  initializing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300",
  cancelled: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  idle: "bg-muted text-muted-foreground",
};

const emptyForm = {
  name: "",
  target_repo_path: "",
  sandbox_provider: "docker" as SandboxProviderName,
  agent_provider: "claude-code",
  model: "claude-opus-4-6",
  max_iterations: 1,
  branch: "",
  prompt: "",
};

export function AgentsView() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [details, setDetails] = useState<AgentDetails | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [logs, setLogs] = useState<RunLogs>({ stdout: "", stderr: "", sandcastle: "" });
  const [patch, setPatch] = useState("");
  const [metrics, setMetrics] = useState<DockerMetricsPayload | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const refreshAgents = useCallback(async () => {
    const nextAgents = await agentApi.listAgents();
    setAgents(nextAgents);
    setSelectedAgentId((current) => current ?? nextAgents[0]?.id ?? null);
  }, []);

  const refreshSelectedAgent = useCallback(async () => {
    if (!selectedAgentId) {
      setDetails(null);
      setRuns([]);
      return;
    }
    const [nextDetails, nextRuns] = await Promise.all([
      agentApi.getAgent(selectedAgentId),
      agentApi.getAgentRuns(selectedAgentId),
    ]);
    setDetails(nextDetails);
    setRuns(nextRuns);
    setSelectedRunId((current) => current ?? nextDetails.agent.latest_run_id ?? nextRuns[0]?.id ?? null);
  }, [selectedAgentId]);

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedAgentId || !selectedRunId) {
      setRunDetails(null);
      setLogs({ stdout: "", stderr: "", sandcastle: "" });
      setPatch("");
      setMetrics(null);
      return;
    }
    const [nextDetails, nextLogs, nextPatch, nextMetrics] = await Promise.all([
      agentApi.getRunDetails(selectedAgentId, selectedRunId),
      agentApi.getRunLogs(selectedAgentId, selectedRunId),
      agentApi.getRunPatch(selectedAgentId, selectedRunId).catch(() => ""),
      agentApi.getLatestMetrics(selectedAgentId, selectedRunId).catch(() => null),
    ]);
    setRunDetails(nextDetails);
    setLogs(nextLogs);
    setPatch(nextPatch);
    setMetrics(nextMetrics);
  }, [selectedAgentId, selectedRunId]);

  useEffect(() => {
    refreshAgents().catch((err: unknown) => setError(getErrorMessage(err)));
  }, [refreshAgents]);

  useEffect(() => {
    refreshSelectedAgent().catch((err: unknown) => setError(getErrorMessage(err)));
  }, [refreshSelectedAgent]);

  useEffect(() => {
    refreshSelectedRun().catch((err: unknown) => setError(getErrorMessage(err)));
  }, [refreshSelectedRun]);

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    const addListener = async <T,>(event: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(event, ({ payload }) => handler(payload));
      if (active) {
        unlisteners.push(unlisten);
      } else {
        unlisten();
      }
    };

    void addListener<StatusChangedPayload>("agent://status-changed", (payload) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === payload.agent_id ? { ...agent, status: payload.status, updated_at: payload.timestamp } : agent,
        ),
      );
      if (payload.agent_id === selectedAgentId) {
        void refreshSelectedAgent();
      }
    });
    void addListener<LogEventPayload>("agent://log", (payload) => {
      if (payload.agent_id !== selectedAgentId) return;
      setLogs((current) => ({
        ...current,
        [payload.stream]: `${current[payload.stream]}${payload.line}\n`,
      }));
    });
    void addListener<DockerMetricsPayload>("agent://docker-metrics", (payload) => {
      if (payload.agent_id === selectedAgentId) {
        setMetrics(payload);
      }
    });
    for (const event of ["agent://created", "agent://run-started", "agent://run-completed", "agent://run-failed", "agent://run-cancelled", "agent://changes-collected"]) {
      void addListener<Record<string, unknown>>(event, () => {
        void refreshAgents();
        void refreshSelectedAgent();
        void refreshSelectedRun();
      });
    }

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refreshAgents, refreshSelectedAgent, refreshSelectedRun, selectedAgentId]);

  const createAgent = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: CreateAgentPayload = {
        name: form.name,
        target_repo_path: form.target_repo_path,
        sandbox_provider: form.sandbox_provider,
        agent_provider: form.agent_provider,
        model: form.model,
        prompt: { type: "inline", value: form.prompt },
        max_iterations: Number(form.max_iterations),
        branch: form.branch.trim() ? form.branch.trim() : null,
      };
      const created = await agentApi.createAgent(payload);
      setForm(emptyForm);
      await refreshAgents();
      setSelectedAgentId(created.agent.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runSelectedAgent = async () => {
    if (!selectedAgentId) return;
    setBusy(true);
    setError(null);
    try {
      const job = await agentApi.runAgent(selectedAgentId);
      setSelectedRunId(job.run_id);
      await refreshAgents();
      await refreshSelectedAgent();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stopSelectedAgent = async () => {
    if (!selectedAgentId) return;
    setBusy(true);
    setError(null);
    try {
      await agentApi.stopAgent(selectedAgentId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelectedAgent = async () => {
    if (!selectedAgentId) return;
    setBusy(true);
    setError(null);
    try {
      await agentApi.deleteAgent(selectedAgentId);
      setSelectedAgentId(null);
      setDetails(null);
      setRuns([]);
      await refreshAgents();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
          <p className="mt-2 text-muted-foreground">Create Sandcastle agents, run them from Rust, and keep every artifact on disk.</p>
        </div>

        {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Create Agent</h2>
            <Bot className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            <Input placeholder="Agent name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Input placeholder="Target repo path" value={form.target_repo_path} onChange={(event) => setForm({ ...form, target_repo_path: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className="h-8 rounded-lg border border-input bg-background px-2 text-sm" value={form.sandbox_provider} onChange={(event) => setForm({ ...form, sandbox_provider: event.target.value as SandboxProviderName })}>
                <option value="docker">Docker</option>
                <option value="podman">Podman</option>
              </select>
              <select className="h-8 rounded-lg border border-input bg-background px-2 text-sm" value={form.agent_provider} onChange={(event) => setForm({ ...form, agent_provider: event.target.value })}>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi</option>
              </select>
            </div>
            <Input placeholder="Model" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
            <div className="grid grid-cols-[1fr_92px] gap-2">
              <Input placeholder="Branch, defaults to agent/name" value={form.branch} onChange={(event) => setForm({ ...form, branch: event.target.value })} />
              <Input type="number" min={1} value={form.max_iterations} onChange={(event) => setForm({ ...form, max_iterations: Number(event.target.value) })} />
            </div>
            <textarea className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="Prompt" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
            <Button className="w-full" disabled={busy} onClick={createAgent}>Create Agent</Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Agent Index</h2>
            <Button variant="ghost" size="icon-sm" onClick={() => void refreshAgents()}><RefreshCw /></Button>
          </div>
          <div className="space-y-2">
            {agents.length === 0 ? <p className="text-sm text-muted-foreground">No agents yet. Create one above to get a dedicated agent directory.</p> : null}
            {agents.map((agent) => (
              <button key={agent.id} className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${agent.id === selectedAgentId ? "border-primary bg-muted" : "border-border"}`} onClick={() => setSelectedAgentId(agent.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[agent.status] ?? statusTone.idle}`}>{agent.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{agent.directory}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Selected Agent</p>
              <h2 className="truncate text-2xl font-bold">{details?.agent.name ?? selectedAgent?.name ?? "No agent selected"}</h2>
              {details ? <p className="mt-1 truncate text-sm text-muted-foreground">Target: {details.agent.target_repo_path}</p> : null}
            </div>
            {details ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || details.agent.status === "running"} onClick={runSelectedAgent}><Play /> Run</Button>
                <Button variant="outline" disabled={busy || details.agent.status !== "running"} onClick={stopSelectedAgent}><Square /> Stop</Button>
                <Button variant="outline" onClick={() => void agentApi.openAgentDirectory(details.agent.id)}><FolderOpen /> Agent Dir</Button>
                <Button variant="destructive" disabled={busy || details.agent.status === "running"} onClick={deleteSelectedAgent}><Trash2 /> Delete</Button>
              </div>
            ) : null}
          </div>

          {details ? (
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <InfoTile label="Status" value={details.agent.status} />
              <InfoTile label="Branch" value={details.agent.branch} />
              <InfoTile label="Model" value={details.agent.model} />
              <InfoTile label="Provider" value={details.agent.sandbox_provider} />
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 min-w-0">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Live Logs</h3>
                <Activity className="size-4 text-muted-foreground" />
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">{logs.stdout || logs.stderr || "Logs will stream here when the agent runs."}</pre>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Changes</h3>
                <FileText className="size-4 text-muted-foreground" />
              </div>
              {runDetails?.changed_files.files.length ? (
                <div className="mb-3 divide-y rounded-lg border">
                  {runDetails.changed_files.files.map((file) => (
                    <div key={file.path} className="flex items-center justify-between gap-3 p-2 text-sm">
                      <span className="truncate">{file.path}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{file.status} +{file.additions} -{file.deletions}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="mb-3 text-sm text-muted-foreground">No changed files captured for this run yet.</p>}
              <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">{patch || "Patch output will be saved in changes.patch after a run."}</pre>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-3 font-semibold">Runs</h3>
              <div className="space-y-2">
                {runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : null}
                {runs.map((run) => (
                  <button key={run.id} className={`w-full rounded-lg border p-2 text-left text-sm transition hover:bg-muted ${run.id === selectedRunId ? "border-primary bg-muted" : "border-border"}`} onClick={() => setSelectedRunId(run.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{run.id}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[run.status] ?? statusTone.idle}`}>{run.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{run.started_at}</p>
                  </button>
                ))}
              </div>
              {selectedAgentId && selectedRunId ? <Button className="mt-3 w-full" variant="outline" onClick={() => void agentApi.openRunDirectory(selectedAgentId, selectedRunId)}>Open Run Directory</Button> : null}
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-3 font-semibold">Metrics</h3>
              <MetricSummary metrics={metrics} />
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-3 font-semibold">Commits</h3>
              {runDetails?.commits.length ? runDetails.commits.map((commit) => (
                <div key={commit.sha} className="mb-2 rounded-lg bg-muted p-2 text-xs">
                  <p className="font-mono">{commit.sha.slice(0, 12)}</p>
                  {commit.summary ? <p className="mt-1 text-muted-foreground">{commit.summary}</p> : null}
                </div>
              )) : <p className="text-sm text-muted-foreground">No commits captured yet.</p>}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function MetricSummary({ metrics }: { metrics: DockerMetricsPayload | null }) {
  if (!metrics) {
    return <p className="text-sm text-muted-foreground">Metrics appear while an agent run is active.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <InfoTile label="CLI" value={metrics.docker_available ? "available" : "missing"} />
        <InfoTile label="Daemon" value={metrics.daemon_running ? "running" : "offline"} />
      </div>
      {metrics.unavailable_reason ? <p className="text-xs text-amber-700 dark:text-amber-300">{metrics.unavailable_reason}</p> : null}
      <p className="text-xs text-muted-foreground">Updated {metrics.timestamp}</p>
      {metrics.containers.length === 0 ? <p className="text-muted-foreground">No active containers reported.</p> : null}
      {metrics.containers.map((container, index) => (
        <div key={`${container.id ?? container.name ?? index}`} className="rounded-lg border p-2 text-xs">
          <p className="truncate font-medium">{container.name ?? container.id ?? "container"}</p>
          <p className="text-muted-foreground">CPU {container.cpu_percent ?? "n/a"} · Mem {container.memory_usage ?? "n/a"}</p>
          <p className="text-muted-foreground">Net {container.network_io ?? "n/a"} · Block {container.block_io ?? "n/a"}</p>
        </div>
      ))}
    </div>
  );
}
