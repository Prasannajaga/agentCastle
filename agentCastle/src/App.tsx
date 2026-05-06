import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  agentApi,
  type AgentDetails,
  type AgentStatus,
  type AgentSummary,
  type ChangedFile,
  type ContainerMetric,
  type CreatedEventPayload,
  type DockerMetricsPayload,
  type LogEventPayload,
  type ProcessMetricsPayload,
  type RunDetails,
  type RunEventPayload,
  type RunLogs,
  type RunRecord,
  type SandboxProviderName,
  type StatusChangedPayload,
  getErrorMessage,
} from "./lib/agents";

type CreateForm = {
  name: string;
  targetRepoPath: string;
  model: string;
  agentProvider: string;
  sandboxProvider: SandboxProviderName;
  prompt: string;
  maxIterations: number;
  branch: string;
};

const emptyForm: CreateForm = {
  name: "",
  targetRepoPath: "",
  model: "claude-sonnet-4-5-20250929",
  agentProvider: "claude-code",
  sandboxProvider: "docker",
  prompt: "",
  maxIterations: 3,
  branch: "",
};

function statusLabel(status: AgentStatus | string): string {
  return status.replace(/_/g, " ");
}

function shortSha(sha: string): string {
  return sha.length > 10 ? sha.slice(0, 10) : sha;
}

function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDetails, setAgentDetails] = useState<AgentDetails | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [runLogs, setRunLogs] = useState<RunLogs>({ stdout: "", stderr: "", sandcastle: "" });
  const [patch, setPatch] = useState("");
  const [liveLogs, setLiveLogs] = useState<LogEventPayload[]>([]);
  const [metrics, setMetrics] = useState<DockerMetricsPayload | null>(null);
  const [processMetrics, setProcessMetrics] = useState<ProcessMetricsPayload | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = agentDetails?.agent ?? null;
  const activeRun = runDetails?.run ?? agentDetails?.latest_run ?? null;

  const refreshAgents = useCallback(async () => {
    const nextAgents = await agentApi.listAgents();
    setAgents(nextAgents);
    setSelectedAgentId((current) => current ?? nextAgents[0]?.id ?? null);
  }, []);

  const refreshSelectedAgent = useCallback(async () => {
    if (!selectedAgentId) {
      setAgentDetails(null);
      setRuns([]);
      return;
    }
    const [details, nextRuns] = await Promise.all([
      agentApi.getAgent(selectedAgentId),
      agentApi.getAgentRuns(selectedAgentId),
    ]);
    setAgentDetails(details);
    setRuns(nextRuns);
    setSelectedRunId((current) => current ?? details.latest_run?.id ?? nextRuns[0]?.id ?? null);
  }, [selectedAgentId]);

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedAgentId || !selectedRunId) {
      setRunDetails(null);
      setRunLogs({ stdout: "", stderr: "", sandcastle: "" });
      setPatch("");
      setMetrics(null);
      return;
    }
    const [details, logs, nextPatch, latestMetrics] = await Promise.all([
      agentApi.getRunDetails(selectedAgentId, selectedRunId),
      agentApi.getRunLogs(selectedAgentId, selectedRunId),
      agentApi.getRunPatch(selectedAgentId, selectedRunId).catch(() => ""),
      agentApi.getLatestMetrics(selectedAgentId, selectedRunId).catch(() => null),
    ]);
    setRunDetails(details);
    setRunLogs(logs);
    setPatch(nextPatch);
    setMetrics(latestMetrics);
  }, [selectedAgentId, selectedRunId]);

  useEffect(() => {
    refreshAgents().catch((nextError) => setError(getErrorMessage(nextError)));
  }, [refreshAgents]);

  useEffect(() => {
    refreshSelectedAgent().catch((nextError) => setError(getErrorMessage(nextError)));
  }, [refreshSelectedAgent]);

  useEffect(() => {
    refreshSelectedRun().catch((nextError) => setError(getErrorMessage(nextError)));
  }, [refreshSelectedRun]);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    async function subscribe() {
      unlisteners.push(
        await listen<CreatedEventPayload>("agent://created", (event) => {
          if (disposed) return;
          setSelectedAgentId(event.payload.agent_id);
          setAgentDetails(event.payload.agent);
          refreshAgents().catch((nextError) => setError(getErrorMessage(nextError)));
        }),
      );
      unlisteners.push(
        await listen<StatusChangedPayload>("agent://status-changed", () => {
          if (disposed) return;
          refreshAgents().catch((nextError) => setError(getErrorMessage(nextError)));
          refreshSelectedAgent().catch((nextError) => setError(getErrorMessage(nextError)));
        }),
      );
      unlisteners.push(
        await listen<RunEventPayload>("agent://run-started", (event) => {
          if (disposed) return;
          setSelectedAgentId(event.payload.agent_id);
          setSelectedRunId(event.payload.run_id);
          setLiveLogs([]);
          refreshSelectedAgent().catch((nextError) => setError(getErrorMessage(nextError)));
        }),
      );
      for (const name of ["agent://run-completed", "agent://run-failed", "agent://run-cancelled", "agent://changes-collected"]) {
        unlisteners.push(
          await listen<RunEventPayload>(name, (event) => {
            if (disposed) return;
            setSelectedRunId(event.payload.run_id);
            refreshAgents().catch((nextError) => setError(getErrorMessage(nextError)));
            refreshSelectedAgent().catch((nextError) => setError(getErrorMessage(nextError)));
            refreshSelectedRun().catch((nextError) => setError(getErrorMessage(nextError)));
          }),
        );
      }
      unlisteners.push(
        await listen<LogEventPayload>("agent://log", (event) => {
          if (disposed) return;
          setLiveLogs((current) => [...current.slice(-400), event.payload]);
        }),
      );
      unlisteners.push(
        await listen<DockerMetricsPayload>("agent://docker-metrics", (event) => {
          if (disposed) return;
          setMetrics(event.payload);
        }),
      );
      unlisteners.push(
        await listen<ProcessMetricsPayload>("agent://process-metrics", (event) => {
          if (disposed) return;
          setProcessMetrics(event.payload);
        }),
      );
    }

    subscribe().catch((nextError) => setError(getErrorMessage(nextError)));
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [refreshAgents, refreshSelectedAgent, refreshSelectedRun]);

  const visibleLogs = useMemo(() => {
    const persisted = [
      runLogs.stdout && `[stdout.log]\n${runLogs.stdout}`,
      runLogs.stderr && `[stderr.log]\n${runLogs.stderr}`,
      runLogs.sandcastle && `[sandcastle.log]\n${runLogs.sandcastle}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const live = liveLogs
      .filter((entry) => !selectedRunId || entry.run_id === selectedRunId)
      .map((entry) => `[${entry.stream}] ${entry.line}`)
      .join("\n");
    return [persisted, live && `[live]\n${live}`].filter(Boolean).join("\n\n");
  }, [liveLogs, runLogs, selectedRunId]);

  async function handleCreateAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await agentApi.createAgent({
        name: form.name,
        target_repo_path: form.targetRepoPath,
        sandbox_provider: form.sandboxProvider,
        model: form.model,
        agent_provider: form.agentProvider || undefined,
        prompt: { type: "inline", value: form.prompt },
        max_iterations: Number(form.maxIterations),
        branch: form.branch.trim() ? form.branch.trim() : null,
      });
      setForm(emptyForm);
      setSelectedAgentId(created.agent.id);
      setAgentDetails(created);
      await refreshAgents();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunAgent() {
    if (!selectedAgent) return;
    setBusy(true);
    setError(null);
    try {
      const job = await agentApi.runAgent(selectedAgent.id);
      setSelectedRunId(job.run_id);
      setLiveLogs([]);
      await refreshSelectedAgent();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleStopAgent() {
    if (!selectedAgent) return;
    setBusy(true);
    setError(null);
    try {
      await agentApi.stopAgent(selectedAgent.id);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAgent() {
    if (!selectedAgent || !confirm(`Delete ${selectedAgent.name}? This removes its AgentCastle directory and run history.`)) return;
    setBusy(true);
    setError(null);
    try {
      await agentApi.deleteAgent(selectedAgent.id);
      setSelectedAgentId(null);
      setAgentDetails(null);
      setSelectedRunId(null);
      setRunDetails(null);
      await refreshAgents();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="eyebrow">AgentCastle</span>
          <h1>Sandcastle runs with receipts.</h1>
        </div>
        <div className="agent-list">
          {agents.length === 0 ? <p className="muted">No agents yet. Create the first one.</p> : null}
          {agents.map((agent) => (
            <button
              className={`agent-card ${agent.id === selectedAgentId ? "selected" : ""}`}
              key={agent.id}
              onClick={() => {
                setSelectedAgentId(agent.id);
                setSelectedRunId(agent.latest_run_id ?? null);
                setLiveLogs([]);
              }}
              type="button"
            >
              <strong>{agent.name}</strong>
              <span>{agent.id}</span>
              <small className={`status ${agent.status}`}>{statusLabel(agent.status)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        {error ? <div className="error-banner">{error}</div> : null}
        <section className="panel create-panel">
          <div>
            <span className="eyebrow">Create</span>
            <h2>New agent</h2>
          </div>
          <form className="create-grid" onSubmit={handleCreateAgent}>
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} placeholder="Fix login bug" required />
            </label>
            <label>
              Target repo path
              <input value={form.targetRepoPath} onChange={(event) => setForm({ ...form, targetRepoPath: event.currentTarget.value })} placeholder="/home/prasanna/coding/my-app" required />
            </label>
            <label>
              Model
              <input value={form.model} onChange={(event) => setForm({ ...form, model: event.currentTarget.value })} required />
            </label>
            <label>
              Agent provider
              <select value={form.agentProvider} onChange={(event) => setForm({ ...form, agentProvider: event.currentTarget.value })}>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi</option>
              </select>
            </label>
            <label>
              Sandbox
              <select value={form.sandboxProvider} onChange={(event) => setForm({ ...form, sandboxProvider: event.currentTarget.value as SandboxProviderName })}>
                <option value="docker">Docker</option>
                <option value="podman">Podman</option>
              </select>
            </label>
            <label>
              Max iterations
              <input min={1} type="number" value={form.maxIterations} onChange={(event) => setForm({ ...form, maxIterations: Number(event.currentTarget.value) })} />
            </label>
            <label>
              Branch override
              <input value={form.branch} onChange={(event) => setForm({ ...form, branch: event.currentTarget.value })} placeholder="agent/fix-login-bug" />
            </label>
            <label className="prompt-field">
              Prompt
              <textarea value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.currentTarget.value })} placeholder="Fix the login bug and add tests." required />
            </label>
            <button disabled={busy} type="submit">Create agent</button>
          </form>
        </section>

        {selectedAgent ? (
          <>
            <section className="hero panel">
              <div>
                <span className="eyebrow">Selected</span>
                <h2>{selectedAgent.name}</h2>
                <p>{selectedAgent.target_repo_path}</p>
              </div>
              <div className="actions">
                <button disabled={busy || selectedAgent.status === "running"} onClick={handleRunAgent} type="button">Run</button>
                <button disabled={busy || selectedAgent.status !== "running"} onClick={handleStopAgent} type="button">Stop</button>
                <button onClick={() => agentApi.openAgentDirectory(selectedAgent.id).catch((nextError) => setError(getErrorMessage(nextError)))} type="button">Open agent dir</button>
                <button className="danger" disabled={busy || selectedAgent.status === "running"} onClick={handleDeleteAgent} type="button">Delete</button>
              </div>
              <dl className="facts">
                <Fact label="Status" value={statusLabel(selectedAgent.status)} />
                <Fact label="Branch" value={selectedAgent.branch} />
                <Fact label="Model" value={selectedAgent.model} />
                <Fact label="Sandbox" value={selectedAgent.sandbox_provider} />
                <Fact label="Agent dir" value={selectedAgent.directory} />
              </dl>
            </section>

            <section className="split">
              <div className="panel">
                <div className="panel-title">
                  <h2>Runs</h2>
                  {activeRun ? <button onClick={() => agentApi.openRunDirectory(activeRun.agent_id, activeRun.id).catch((nextError) => setError(getErrorMessage(nextError)))} type="button">Open run dir</button> : null}
                </div>
                <div className="run-list">
                  {runs.length === 0 ? <p className="muted">No runs recorded yet.</p> : null}
                  {runs.map((run) => (
                    <button className={`run-card ${run.id === selectedRunId ? "selected" : ""}`} key={run.id} onClick={() => setSelectedRunId(run.id)} type="button">
                      <span>{run.id}</span>
                      <small className={`status ${run.status}`}>{run.status}</small>
                      <small>{run.started_at}</small>
                    </button>
                  ))}
                </div>
              </div>

              <MetricsPanel metrics={metrics} processMetrics={processMetrics} />
            </section>

            {runDetails ? (
              <section className="panel run-details">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">Run details</span>
                    <h2>{runDetails.run.id}</h2>
                  </div>
                  <span className={`status ${runDetails.run.status}`}>{runDetails.run.status}</span>
                </div>
                {runDetails.run.error ? <div className="error-banner">{runDetails.run.error}</div> : null}
                {runDetails.run.warning ? <div className="warning-banner">{runDetails.run.warning}</div> : null}
                <dl className="facts">
                  <Fact label="Started" value={runDetails.run.started_at} />
                  <Fact label="Ended" value={runDetails.run.ended_at ?? "Still running"} />
                  <Fact label="Worktree" value={runDetails.run.worktree_path ?? "None preserved"} />
                  <Fact label="Patch" value={runDetails.run.changes_patch} />
                </dl>
                <div className="detail-grid">
                  <ChangeList files={runDetails.changed_files.files} />
                  <CommitList commits={runDetails.commits} />
                </div>
                <ArtifactViewer title="Logs" content={visibleLogs || "Logs will stream here while the Rust runner is active."} />
                <ArtifactViewer title="Patch" content={patch || "No patch captured yet."} />
              </section>
            ) : null}
          </>
        ) : (
          <section className="panel empty-state">
            <h2>No agent selected</h2>
            <p>Create or select an agent to see logs, metrics, patches, commits, and run history.</p>
          </section>
        )}
      </section>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function MetricsPanel({ metrics, processMetrics }: { metrics: DockerMetricsPayload | null; processMetrics: ProcessMetricsPayload | null }) {
  return (
    <section className="panel metrics-panel">
      <div className="panel-title">
        <h2>Metrics</h2>
        <span>{metrics?.timestamp ?? "Waiting"}</span>
      </div>
      <dl className="facts compact">
        <Fact label="Provider" value={metrics?.provider ?? "unknown"} />
        <Fact label="CLI" value={metrics ? String(metrics.docker_available) : "unknown"} />
        <Fact label="Daemon" value={metrics ? String(metrics.daemon_running) : "unknown"} />
        <Fact label="Process" value={processMetrics?.process_running ? `running pid ${processMetrics.pid ?? "?"}` : "idle"} />
      </dl>
      {metrics?.unavailable_reason ? <p className="muted">{metrics.unavailable_reason}</p> : null}
      <div className="container-list">
        {metrics?.containers.length ? metrics.containers.map((container, index) => <ContainerRow container={container} key={`${container.id ?? container.name ?? index}`} />) : <p className="muted">No Sandcastle containers detected yet.</p>}
      </div>
    </section>
  );
}

function ContainerRow({ container }: { container: ContainerMetric }) {
  return (
    <div className="container-row">
      <strong>{container.name ?? container.id ?? "container"}</strong>
      <span>{container.status ?? "unknown"}</span>
      <span>CPU {container.cpu_percent ?? "n/a"}</span>
      <span>Mem {container.memory_usage ?? "n/a"}{container.memory_limit ? ` / ${container.memory_limit}` : ""}</span>
      <span>Net {container.network_io ?? "n/a"}</span>
      <span>Block {container.block_io ?? "n/a"}</span>
    </div>
  );
}

function ChangeList({ files }: { files: ChangedFile[] }) {
  return (
    <section className="artifact-card">
      <h3>Changed files</h3>
      {files.length === 0 ? <p className="muted">No changed files captured.</p> : null}
      {files.map((file) => (
        <div className="file-row" key={`${file.status}-${file.path}`}>
          <span>{file.status}</span>
          <strong>{file.path}</strong>
          <small>+{file.additions} -{file.deletions}</small>
        </div>
      ))}
    </section>
  );
}

function CommitList({ commits }: { commits: { sha: string; summary?: string | null }[] }) {
  return (
    <section className="artifact-card">
      <h3>Commits</h3>
      {commits.length === 0 ? <p className="muted">No commits captured.</p> : null}
      {commits.map((commit) => (
        <div className="file-row" key={commit.sha}>
          <span>{shortSha(commit.sha)}</span>
          <strong>{commit.summary ?? "Sandcastle commit"}</strong>
        </div>
      ))}
    </section>
  );
}

function ArtifactViewer({ title, content }: { title: string; content: string }) {
  return (
    <section className="artifact-card wide">
      <h3>{title}</h3>
      <pre>{content}</pre>
    </section>
  );
}

export default App;
