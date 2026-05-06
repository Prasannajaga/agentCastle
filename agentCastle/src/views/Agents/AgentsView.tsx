import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { RefreshCcw, Plus, Bot, Clock, FolderOpen, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateAgentDialog } from "./CreateAgentDialog";
import {
  agentApi,
  type AgentSummary,
  type StatusChangedPayload,
  getErrorMessage,
} from "@/lib/agents";
import { AGENTS_CONFIG } from "@/config/agents.config";

export function AgentsView() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    try {
      const nextAgents = await agentApi.listAgents();
      setAgents(nextAgents);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  // Real-time status updates
  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    const subscribe = async () => {
      const unlistenStatus = await listen<StatusChangedPayload>(
        "agent://status-changed",
        ({ payload }) => {
          setAgents((current) =>
            current.map((agent) =>
              agent.id === payload.agent_id
                ? { ...agent, status: payload.status, updated_at: payload.timestamp }
                : agent
            )
          );
        }
      );
      if (active) unlisteners.push(unlistenStatus);
      else unlistenStatus();

      for (const event of [
        "agent://created",
        "agent://run-started",
        "agent://run-completed",
        "agent://run-failed",
        "agent://run-cancelled",
      ]) {
        const unlisten = await listen(event, () => void refreshAgents());
        if (active) unlisteners.push(unlisten);
        else unlisten();
      }
    };

    void subscribe();
    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [refreshAgents]);

  const handleCreated = useCallback(
    (agentId: string) => {
      void refreshAgents();
      navigate(`/agents/${agentId}`);
    },
    [refreshAgents, navigate]
  );

  const runningCount = agents.filter((a) => a.status === "running").length;
  const readyCount = agents.filter((a) => a.status === "ready").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create, manage, and monitor your Sandcastle agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void refreshAgents()}
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <CreateAgentDialog onCreated={handleCreated}>
            <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Agent
            </Button>
          </CreateAgentDialog>
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <Alert variant="destructive" className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Quick stats */}
      {agents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            <Bot className="h-3.5 w-3.5" />
            {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </Badge>
          {runningCount > 0 ? (
            <Badge variant="outline" className="text-xs">
              <Zap className="h-3.5 w-3.5 text-sky-400" />
              {runningCount} running
            </Badge>
          ) : null}
          {readyCount > 0 ? (
            <Badge variant="success" className="text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {readyCount} ready
            </Badge>
          ) : null}
        </div>
      ) : null}

      {/* Agent grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-[16px] w-[60%]" />
                <Skeleton className="h-[12px] w-[35%]" />
                <Skeleton className="h-[12px] w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="bg-muted/50 border border-border/40 p-4 rounded-2xl mb-4">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <h3 className="font-semibold text-sm mb-1">No agents yet</h3>
          <p className="text-xs text-muted-foreground max-w-[280px]">
            Create your first agent to start running automated tasks in sandboxed environments.
          </p>
          <CreateAgentDialog onCreated={handleCreated}>
            <Button size="sm" className="mt-4 bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create Agent
            </Button>
          </CreateAgentDialog>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onClick={() => navigate(`/agents/${agent.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onClick,
}: {
  agent: AgentSummary;
  onClick: () => void;
}) {
  const statusStyle = AGENTS_CONFIG.statusColors[agent.status] ?? AGENTS_CONFIG.statusColors.idle;
  const isRunning = agent.status === "running";

  const formattedDate = (() => {
    try {
      const d = new Date(agent.updated_at || agent.created_at);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      className="card-hover rounded-xl border border-border/30 bg-card p-5 text-left cursor-pointer group flex flex-col gap-3.5 focus-visible:ring-2 focus-visible:ring-ring outline-none"
    >
      {/* Top row: icon + name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 items-center min-w-0">
          <div className="bg-muted border border-border/40 p-2 rounded-lg text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="font-semibold text-[13px] leading-tight truncate">
              {agent.name}
            </h3>
            {formattedDate ? (
              <div className="flex items-center text-[11px] text-muted-foreground mt-0.5">
                <Clock className="h-3 w-3 mr-1 shrink-0" />
                {formattedDate}
              </div>
            ) : null}
          </div>
        </div>
        <Badge className={`${statusStyle.bg} ${statusStyle.text} shrink-0`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot} ${isRunning ? "animate-status-pulse" : ""}`}
          />
          {agent.status}
        </Badge>
      </div>

      {/* Directory path */}
      <div className="flex items-center gap-1.5 text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
        <FolderOpen className="h-3 w-3 shrink-0" />
        <p className="font-mono text-[10px] truncate">{agent.directory}</p>
      </div>
    </button>
  );
}
