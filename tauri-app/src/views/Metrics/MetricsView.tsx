import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Activity, Boxes, Cpu, HardDrive, Network } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { agentApi, type AgentSummary, type DockerMetricsPayload, getErrorMessage } from "@/lib/agents";

export function MetricsView() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [metricsByAgent, setMetricsByAgent] = useState<Record<string, DockerMetricsPayload>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const nextAgents = await agentApi.listAgents();
      if (!active) return;
      setAgents(nextAgents);
      const pairs = await Promise.all(
        nextAgents.map(async (agent) => {
          if (!agent.latest_run_id) return null;
          const metrics = await agentApi.getLatestMetrics(agent.id, agent.latest_run_id).catch(() => null);
          return metrics ? ([agent.id, metrics] as const) : null;
        }),
      );
      if (!active) return;
      const entries = pairs.filter(
        (pair): pair is readonly [string, DockerMetricsPayload] => pair !== null,
      );
      setMetricsByAgent(Object.fromEntries(entries));
    };
    load().catch((err: unknown) => setError(getErrorMessage(err)));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    listen<DockerMetricsPayload>("agent://docker-metrics", ({ payload }) => {
      setMetricsByAgent((current) => ({ ...current, [payload.agent_id]: payload }));
    }).then((nextUnlisten) => {
      if (active) {
        unlisten = nextUnlisten;
      } else {
        nextUnlisten();
      }
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
      running: agents.filter((agent) => agent.status === "running").length,
      daemons: metrics.filter((metric) => metric.daemon_running).length,
      containers: metrics.reduce((count, metric) => count + metric.containers.length, 0),
    };
  }, [agents, metricsByAgent]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Metrics</h1>
        <p className="mt-2 text-muted-foreground">Docker, Podman, and process telemetry emitted by the Rust backend while agents run.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard icon={<Activity />} label="Agents" value={String(totals.agents)} />
        <MetricCard icon={<Cpu />} label="Running" value={String(totals.running)} />
        <MetricCard icon={<HardDrive />} label="Daemons Online" value={String(totals.daemons)} />
        <MetricCard icon={<Boxes />} label="Containers" value={String(totals.containers)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {agents.length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No agents have been created yet.</p> : null}
        {agents.map((agent) => {
          const metrics = metricsByAgent[agent.id];
          return (
            <section key={agent.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{agent.name}</h2>
                  <p className="text-xs text-muted-foreground">{agent.latest_run_id ?? "No runs yet"}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{agent.status}</span>
              </div>
              {metrics ? <AgentMetrics metrics={metrics} /> : <p className="text-sm text-muted-foreground">No metrics have been captured for this agent yet.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-muted-foreground">
        <span className="text-sm">{label}</span>
        <span className="[&_svg]:size-4">{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function AgentMetrics({ metrics }: { metrics: DockerMetricsPayload }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <MiniMetric label="Provider" value={metrics.provider} />
        <MiniMetric label="CLI" value={metrics.docker_available ? "available" : "missing"} />
        <MiniMetric label="Daemon" value={metrics.daemon_running ? "running" : "offline"} />
      </div>
      {metrics.unavailable_reason ? <p className="text-amber-700 dark:text-amber-300">{metrics.unavailable_reason}</p> : null}
      <p className="text-xs text-muted-foreground">Last updated {metrics.timestamp}</p>
      <div className="space-y-2">
        {metrics.containers.length === 0 ? <p className="text-muted-foreground">No containers reported in the latest sample.</p> : null}
        {metrics.containers.map((container, index) => (
          <div key={`${container.id ?? container.name ?? index}`} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" />
              <p className="truncate font-medium">{container.name ?? container.id ?? "container"}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MiniMetric label="CPU" value={container.cpu_percent ?? "n/a"} />
              <MiniMetric label="Memory" value={container.memory_usage ?? "n/a"} />
              <MiniMetric label="Network IO" value={container.network_io ?? "n/a"} />
              <MiniMetric label="Block IO" value={container.block_io ?? "n/a"} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}
