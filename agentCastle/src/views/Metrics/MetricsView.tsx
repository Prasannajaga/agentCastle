import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  Boxes,
  HardDrive,
  Network,
  TrendingUp,
  CircleDot,
  ArrowLeft,
  Cpu,
  FolderOpen,
  Clock,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  agentApi,
  type AgentSummary,
  type RunRecord,
  type DockerMetricsPayload,
  getErrorMessage,
} from "@/lib/agents";
import { AGENTS_CONFIG } from "@/config/agents.config";

type DetailedAgent = {
  agent: AgentSummary;
  runs: RunRecord[];
  metrics: DockerMetricsPayload | null;
};

export function MetricsView() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [metricsByAgent, setMetricsByAgent] = useState<Record<string, DockerMetricsPayload>>({});
  const [runsByAgent, setRunsByAgent] = useState<Record<string, RunRecord[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const nextAgents = await agentApi.listAgents();
      setAgents(nextAgents);

      const [metricPairs, runPairs] = await Promise.all([
        Promise.all(
          nextAgents.map(async (agent) => {
            if (!agent.latest_run_id) return null;
            const metrics = await agentApi
              .getLatestMetrics(agent.id, agent.latest_run_id)
              .catch(() => null);
            return metrics ? ([agent.id, metrics] as const) : null;
          })
        ),
        Promise.all(
          nextAgents.map(async (agent) => {
            const runs = await agentApi.getAgentRuns(agent.id).catch(() => []);
            return [agent.id, runs] as const;
          })
        ),
      ]);

      const metricEntries = metricPairs.filter(
        (pair): pair is readonly [string, DockerMetricsPayload] => pair !== null
      );
      setMetricsByAgent(Object.fromEntries(metricEntries));
      setRunsByAgent(Object.fromEntries(runPairs));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Live metrics stream
  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    listen<DockerMetricsPayload>("agent://docker-metrics", ({ payload }) => {
      setMetricsByAgent((current) => ({ ...current, [payload.agent_id]: payload }));
    }).then((nextUnlisten) => {
      if (active) unlisten = nextUnlisten;
      else nextUnlisten();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const totals = useMemo(() => {
    const metrics = Object.values(metricsByAgent);
    return {
      agents: agents.length,
      running: agents.filter((a) => a.status === "running").length,
      daemons: metrics.filter((m) => m.daemon_running).length,
      containers: metrics.reduce((count, m) => count + m.containers.length, 0),
    };
  }, [agents, metricsByAgent]);

  // Selected agent detail
  const selectedDetail: DetailedAgent | null = useMemo(() => {
    if (!selectedAgentId) return null;
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (!agent) return null;
    return {
      agent,
      runs: runsByAgent[selectedAgentId] ?? [],
      metrics: metricsByAgent[selectedAgentId] ?? null,
    };
  }, [selectedAgentId, agents, runsByAgent, metricsByAgent]);

  // If detail view is selected, show it
  if (selectedDetail) {
    return (
      <MetricsDetailView
        detail={selectedDetail}
        onBack={() => setSelectedAgentId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Metrics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time telemetry from Docker, Podman, and agent processes.
        </p>
      </div>

      {/* Error */}
      {error ? (
        <Alert variant="destructive" className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 stagger-children">
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Total Agents"
          value={String(totals.agents)}
          accent="text-foreground"
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Active"
          value={String(totals.running)}
          accent={totals.running > 0 ? "text-sky-400" : "text-muted-foreground"}
        />
        <MetricCard
          icon={<HardDrive className="h-4 w-4" />}
          label="Daemons Online"
          value={String(totals.daemons)}
          accent={totals.daemons > 0 ? "text-emerald-400" : "text-muted-foreground"}
        />
        <MetricCard
          icon={<Boxes className="h-4 w-4" />}
          label="Containers"
          value={String(totals.containers)}
          accent={totals.containers > 0 ? "text-amber-400" : "text-muted-foreground"}
        />
      </div>

      {/* Per-agent metrics — clickable cards */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Agent Breakdown
        </h2>

        {agents.length === 0 ? (
          <Card className="p-8 text-center">
            <CircleDot className="h-6 w-6 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No agents have been created yet.</p>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2 stagger-children">
            {agents.map((agent) => {
              const agentMetrics = metricsByAgent[agent.id];
              const agentRuns = runsByAgent[agent.id] ?? [];
              const statusStyle =
                AGENTS_CONFIG.statusColors[agent.status] ?? AGENTS_CONFIG.statusColors.idle;

              return (
                <section
                  key={agent.id}
                  className="card-hover rounded-xl border border-border/30 bg-card p-5 cursor-pointer"
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-sm">{agent.name}</h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground/50 mt-0.5 truncate">
                        {agent.latest_run_id
                          ? `Run ${agent.latest_run_id.slice(0, 12)}`
                          : "No runs yet"}
                        {agentRuns.length > 0 ? ` · ${agentRuns.length} total runs` : ""}
                      </p>
                    </div>
                    <Badge className={`${statusStyle.bg} ${statusStyle.text} shrink-0`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                      {agent.status}
                    </Badge>
                  </div>

                  {agentMetrics ? (
                    <AgentMetricsPanel metrics={agentMetrics} />
                  ) : (
                    <p className="text-xs text-muted-foreground/40">
                      No metrics captured yet. Click to view details.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Detailed view shown when clicking a metrics card.
 * Contains runs list, full metrics, and container details.
 */
function MetricsDetailView({
  detail,
  onBack,
}: {
  detail: DetailedAgent;
  onBack: () => void;
}) {
  const { agent, runs, metrics } = detail;
  const statusStyle =
    AGENTS_CONFIG.statusColors[agent.status] ?? AGENTS_CONFIG.statusColors.idle;

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      {/* Back + Header */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground hover:text-foreground -ml-1.5 h-7"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          All Metrics
        </Button>

        <div className="flex items-start justify-between gap-4 pb-5 border-b border-border/30">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight truncate capitalize">
              {agent.name}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <Badge className={`${statusStyle.bg} ${statusStyle.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                {agent.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics + Runs grid */}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Runtime Metrics */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Runtime Metrics
          </h2>

          {metrics ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <MiniTile label="Provider" value={metrics.provider} />
                <MiniTile
                  label="CLI"
                  value={metrics.docker_available ? "Available" : "Missing"}
                  positive={metrics.docker_available}
                />
                <MiniTile
                  label="Daemon"
                  value={metrics.daemon_running ? "Running" : "Offline"}
                  positive={metrics.daemon_running}
                />
              </div>

              {metrics.unavailable_reason ? (
                <p className="text-[11px] text-amber-400/80">{metrics.unavailable_reason}</p>
              ) : null}

              <p className="text-[10px] text-muted-foreground/40">
                Last updated: {metrics.timestamp}
              </p>

              {/* Containers */}
              {metrics.containers.length === 0 ? (
                <Card className="p-6 text-center">
                  <Cpu className="h-5 w-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/50">
                    No containers in latest sample.
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {metrics.containers.map((c, i) => (
                    <div
                      key={`${c.id ?? c.name ?? i}`}
                      className="rounded-xl border border-border/20 bg-muted/20 p-4"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Network className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate font-medium text-sm">
                          {c.name ?? c.id ?? "container"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <MiniTile label="CPU" value={c.cpu_percent ?? "n/a"} />
                        <MiniTile label="Memory" value={c.memory_usage ?? "n/a"} />
                        <MiniTile label="Network" value={c.network_io ?? "n/a"} />
                        <MiniTile label="Block I/O" value={c.block_io ?? "n/a"} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <Cpu className="h-6 w-6 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No runtime metrics captured yet.
              </p>
              <p className="text-xs text-muted-foreground/50 mt-1">
                Metrics will appear when the agent is actively running.
              </p>
            </Card>
          )}
        </div>

        {/* Runs sidebar */}
        <aside className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Runs ({runs.length})
          </h2>

          <ScrollArea className="max-h-[500px]">
            <div className="space-y-2 pr-2">
              {runs.length === 0 ? (
                <Card className="p-6 text-center">
                  <p className="text-xs text-muted-foreground/50">No runs recorded yet.</p>
                </Card>
              ) : null}
              {runs.map((run) => {
                const rs =
                  AGENTS_CONFIG.statusColors[run.status] ?? AGENTS_CONFIG.statusColors.idle;
                return (
                  <div
                    key={run.id}
                    className="rounded-lg border border-border/20 bg-muted/15 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="truncate font-mono text-[11px]">
                        {run.id.slice(0, 12)}
                      </span>
                      <Badge className={`${rs.bg} ${rs.text} text-[9px]`}>
                        <span className={`h-1 w-1 rounded-full ${rs.dot}`} />
                        {run.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                      <Clock className="h-2.5 w-2.5" />
                      {run.started_at}
                    </div>
                    {run.error ? (
                      <p className="mt-1.5 text-[10px] text-destructive/80 truncate">
                        {run.error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {runs.length > 0 && agent.latest_run_id ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() =>
                void agentApi.openRunDirectory(agent.id, agent.latest_run_id!)
              }
            >
              <FolderOpen className="h-3 w-3 mr-1" />
              Open Latest Run Dir
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{label}</span>
          <span className="[&_svg]:h-3.5 [&_svg]:w-3.5 opacity-50">{icon}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className={`text-2xl font-bold tracking-tight ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function AgentMetricsPanel({ metrics }: { metrics: DockerMetricsPayload }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <MiniTile label="Provider" value={metrics.provider} />
        <MiniTile
          label="CLI"
          value={metrics.docker_available ? "Available" : "Missing"}
          positive={metrics.docker_available}
        />
        <MiniTile
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
        <p className="text-muted-foreground/40">No containers in latest sample.</p>
      ) : null}

      <div className="space-y-2">
        {metrics.containers.map((c, i) => (
          <div
            key={`${c.id ?? c.name ?? i}`}
            className="rounded-lg border border-border/20 bg-muted/20 p-2.5"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Network className="h-3 w-3 text-muted-foreground/60" />
              <span className="truncate font-medium text-xs">{c.name ?? c.id ?? "container"}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <MiniTile label="CPU" value={c.cpu_percent ?? "n/a"} />
              <MiniTile label="Memory" value={c.memory_usage ?? "n/a"} />
              <MiniTile label="Network" value={c.network_io ?? "n/a"} />
              <MiniTile label="Block I/O" value={c.block_io ?? "n/a"} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniTile({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  let valueColor = "text-foreground";
  if (positive === true) valueColor = "text-emerald-400";
  if (positive === false) valueColor = "text-red-400";

  return (
    <div className="rounded-md bg-muted/30 border border-border/15 p-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50">{label}</p>
      <p className={`truncate font-medium text-[11px] ${valueColor}`}>{value}</p>
    </div>
  );
}
