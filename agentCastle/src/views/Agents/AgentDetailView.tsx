import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Clock,
  Terminal,
  GitBranch,
  FileDiff,
  Play,
  Square,
  Trash2,
  FolderOpen,
  Cpu,
  HardDrive,
  Network,
  Loader2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  agentApi,
  type AgentDetails,
  type RunRecord,
  type RunDetails,
  type RunLogs,
  type DockerMetricsPayload,
  type LogEventPayload,
  type StatusChangedPayload,
  getErrorMessage,
} from "@/lib/agents";
import { AGENTS_CONFIG } from "@/config/agents.config";

export function AgentDetailView() {
  const navigate = useNavigate();
  const { id: agentId } = useParams<{ id: string }>();

  const [details, setDetails] = useState<AgentDetails | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [logs, setLogs] = useState<RunLogs>({ stdout: "", stderr: "", sandcastle: "" });
  const [patch, setPatch] = useState("");
  const [metrics, setMetrics] = useState<DockerMetricsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const [nextDetails, nextRuns] = await Promise.all([
        agentApi.getAgent(agentId),
        agentApi.getAgentRuns(agentId),
      ]);
      setDetails(nextDetails);
      setRuns(nextRuns);
      setSelectedRunId((cur) => cur ?? nextDetails.agent.latest_run_id ?? nextRuns[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const refreshRun = useCallback(async () => {
    if (!agentId || !selectedRunId) {
      setRunDetails(null);
      setLogs({ stdout: "", stderr: "", sandcastle: "" });
      setPatch("");
      setMetrics(null);
      return;
    }
    try {
      const [rd, rl, rp, rm] = await Promise.all([
        agentApi.getRunDetails(agentId, selectedRunId),
        agentApi.getRunLogs(agentId, selectedRunId),
        agentApi.getRunPatch(agentId, selectedRunId).catch(() => ""),
        agentApi.getLatestMetrics(agentId, selectedRunId).catch(() => null),
      ]);
      setRunDetails(rd);
      setLogs(rl);
      setPatch(rp);
      setMetrics(rm);
    } catch {
      /* run details might not exist yet */
    }
  }, [agentId, selectedRunId]);

  useEffect(() => {
    void refreshAgent();
  }, [refreshAgent]);

  useEffect(() => {
    void refreshRun();
  }, [refreshRun]);

  // Real-time event listeners
  useEffect(() => {
    if (!agentId) return;
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    const subscribe = async () => {
      const add = async <T,>(event: string, handler: (p: T) => void) => {
        const u = await listen<T>(event, ({ payload }) => handler(payload));
        if (active) unlisteners.push(u);
        else u();
      };

      await add<StatusChangedPayload>("agent://status-changed", (p) => {
        if (p.agent_id === agentId) void refreshAgent();
      });

      await add<LogEventPayload>("agent://log", (p) => {
        if (p.agent_id !== agentId) return;
        setLogs((cur) => ({
          ...cur,
          [p.stream]: `${cur[p.stream]}${p.line}\n`,
        }));
      });

      await add<DockerMetricsPayload>("agent://docker-metrics", (p) => {
        if (p.agent_id === agentId) setMetrics(p);
      });

      for (const ev of [
        "agent://run-started",
        "agent://run-completed",
        "agent://run-failed",
        "agent://run-cancelled",
        "agent://changes-collected",
      ]) {
        await add<Record<string, unknown>>(ev, () => {
          void refreshAgent();
          void refreshRun();
        });
      }
    };

    void subscribe();
    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [agentId, refreshAgent, refreshRun]);

  const runAgent = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const job = await agentApi.runAgent(agentId);
      setSelectedRunId(job.run_id);
      await refreshAgent();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stopAgent = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      await agentApi.stopAgent(agentId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      await agentApi.deleteAgent(agentId);
      navigate("/");
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const agent = details?.agent;
  const statusStyle = AGENTS_CONFIG.statusColors[agent?.status ?? "idle"] ?? AGENTS_CONFIG.statusColors.idle;
  const isRunning = agent?.status === "running";

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      {/* Back + Header */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground hover:text-foreground -ml-1.5 h-7"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          All Agents
        </Button>

        <div className="flex items-start justify-between gap-4 pb-5 border-b border-border/30">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="bg-muted border border-border/40 p-2.5 rounded-xl text-foreground shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight truncate capitalize">
                {agent?.name ?? "Agent"}
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {agent?.created_at ? (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(agent.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                ) : null}
                <Badge className={`${statusStyle.bg} ${statusStyle.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot} ${isRunning ? "animate-status-pulse" : ""}`} />
                  {agent?.status ?? "unknown"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Actions */}
          {agent ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || isRunning}
                onClick={() => void runAgent()}
                className="text-xs"
              >
                <Play className="h-3 w-3 mr-1" />
                Run
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !isRunning}
                onClick={() => void stopAgent()}
                className="text-xs"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void agentApi.openAgentDirectory(agent.id)}
                className="text-xs text-muted-foreground"
              >
                <FolderOpen className="h-3 w-3 mr-1" />
                Open
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || isRunning}
                onClick={() => void deleteAgent()}
                className="text-xs"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Error */}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Agent info tiles */}
      {agent ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InfoTile label="Model" value={agent.model} />
          <InfoTile label="Provider" value={agent.agent_provider} />
          <InfoTile label="Sandbox" value={agent.sandbox_provider} />
          <InfoTile label="Branch" value={agent.branch} />
        </div>
      ) : null}

      {/* Main content: tabs + sidebar */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Tabs: Logs, Changes, Commits */}
        <Tabs defaultValue="logs" className="flex flex-col min-h-0">
          <TabsList className="w-fit border-border/30 bg-muted/30">
            <TabsTrigger value="logs" className="text-xs gap-1.5">
              <Terminal className="h-3 w-3" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="changes" className="text-xs gap-1.5">
              <FileDiff className="h-3 w-3" />
              Changes
            </TabsTrigger>
            <TabsTrigger value="commits" className="text-xs gap-1.5">
              <GitBranch className="h-3 w-3" />
              Commits
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-3">
            <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
              <ScrollArea className="h-[360px] w-full">
                <pre className="bg-muted/30 p-4 font-mono text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                  {logs.stdout || logs.stderr || "Logs will stream here when the agent runs."}
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="changes" className="mt-3">
            <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
              {runDetails?.changed_files.files.length ? (
                <div className="divide-y divide-border/20">
                  {runDetails.changed_files.files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                    >
                      <span className="font-mono truncate text-muted-foreground">
                        {file.path}
                      </span>
                      <span className="shrink-0 text-muted-foreground/60">
                        {file.status}{" "}
                        <span className="text-emerald-500">+{file.additions}</span>{" "}
                        <span className="text-red-400">-{file.deletions}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <ScrollArea className="h-[300px] w-full">
                <pre className="bg-muted/30 p-4 font-mono text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                  {patch || "Patch output will appear after a run."}
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="commits" className="mt-3">
            <div className="rounded-xl border border-border/30 bg-card p-4 min-h-[200px]">
              {runDetails?.commits.length ? (
                <div className="space-y-2">
                  {runDetails.commits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="rounded-lg bg-muted/30 border border-border/20 p-3 text-xs"
                    >
                      <p className="font-mono text-muted-foreground">{commit.sha.slice(0, 12)}</p>
                      {commit.summary ? (
                        <p className="mt-1 text-muted-foreground/70">{commit.summary}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground/40">
                  <GitBranch className="h-6 w-6 mb-2" />
                  <p className="text-xs">No commits captured yet.</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Right sidebar: Runs + Metrics */}
        <aside className="flex flex-col gap-4">
          {/* Runs */}
          <Card className="p-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-[200px] overflow-y-auto pt-0">
              {runs.length === 0 ? (
                <p className="text-xs text-muted-foreground/50">No runs yet.</p>
              ) : null}
              {runs.map((run) => {
                const rs = AGENTS_CONFIG.statusColors[run.status] ?? AGENTS_CONFIG.statusColors.idle;
                return (
                  <button
                    key={run.id}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:bg-muted/50 ${
                      run.id === selectedRunId
                        ? "border-foreground/20 bg-muted/40"
                        : "border-border/20"
                    }`}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px]">{run.id.slice(0, 12)}</span>
                      <Badge className={`${rs.bg} ${rs.text} text-[9px]`}>
                        <span className={`h-1 w-1 rounded-full ${rs.dot}`} />
                        {run.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/50">{run.started_at}</p>
                  </button>
                );
              })}
            </CardContent>
            {agentId && selectedRunId ? (
              <Button
                className="mt-3 w-full text-xs"
                variant="outline"
                size="sm"
                onClick={() => void agentApi.openRunDirectory(agentId, selectedRunId)}
              >
                <FolderOpen className="h-3 w-3 mr-1" />
                Open Run Dir
              </Button>
            ) : null}
          </Card>

          {/* Metrics */}
          <Card className="p-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Runtime Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <MetricsSidebar metrics={metrics} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-border/20 bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="mt-1 text-sm font-medium truncate">{value}</p>
    </Card>
  );
}

function MetricsSidebar({ metrics }: { metrics: DockerMetricsPayload | null }) {
  if (!metrics) {
    return (
      <div className="flex flex-col items-center py-6 text-muted-foreground/40">
        <Cpu className="h-5 w-5 mb-2" />
        <p className="text-[11px]">Metrics appear during active runs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric
          icon={<HardDrive className="h-3 w-3" />}
          label="CLI"
          value={metrics.docker_available ? "Available" : "Missing"}
          positive={metrics.docker_available}
        />
        <MiniMetric
          icon={<Cpu className="h-3 w-3" />}
          label="Daemon"
          value={metrics.daemon_running ? "Running" : "Offline"}
          positive={metrics.daemon_running}
        />
      </div>

      {metrics.unavailable_reason ? (
        <p className="text-[11px] text-amber-400/80">{metrics.unavailable_reason}</p>
      ) : null}

      <p className="text-[10px] text-muted-foreground/40">Updated {metrics.timestamp}</p>

      {metrics.containers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/40">No active containers.</p>
      ) : null}

      {metrics.containers.map((c, i) => (
        <div
          key={`${c.id ?? c.name ?? i}`}
          className="rounded-lg border border-border/20 bg-muted/20 p-2.5 space-y-1.5"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Network className="h-3 w-3 text-muted-foreground" />
            <span className="truncate font-medium">{c.name ?? c.id ?? "container"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
            <span>CPU {c.cpu_percent ?? "n/a"}</span>
            <span>Mem {c.memory_usage ?? "n/a"}</span>
            <span>Net {c.network_io ?? "n/a"}</span>
            <span>I/O {c.block_io ?? "n/a"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({
  icon,
  label,
  value,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/20 border border-border/20 p-2">
      <div className="flex items-center gap-1.5 text-muted-foreground/60 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xs font-medium ${positive ? "text-emerald-400" : "text-red-400"}`}>
        {value}
      </p>
    </div>
  );
}
