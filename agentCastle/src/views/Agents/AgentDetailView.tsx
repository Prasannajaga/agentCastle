import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Loader2,
  AlertCircle,
  Radio,
  FileCode,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  agentApi,
  type AgentDetails,
  type RunDetails,
  type RunLogs,
  type LogEventPayload,
  type StatusChangedPayload,
  getErrorMessage,
} from "@/lib/agents";
import { AGENTS_CONFIG } from "@/config/agents.config";
import { THEME_CONFIG } from "@/config/theme.config";

type LogSource = "stdout" | "stderr" | "sandcastle";

const LOG_SOURCE_LABELS: Readonly<Record<LogSource, string>> = Object.freeze({
  stdout: "Agent Output",
  stderr: "Errors",
  sandcastle: "Sandcastle",
});

export function AgentDetailView() {
  const navigate = useNavigate();
  const { id: agentId } = useParams<{ id: string }>();

  const [details, setDetails] = useState<AgentDetails | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [logs, setLogs] = useState<RunLogs>({ stdout: "", stderr: "", sandcastle: "" });
  const [patch, setPatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLogSource, setActiveLogSource] = useState<LogSource>("stdout");
  const [isStreaming, setIsStreaming] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  const scrollToLogBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const refreshAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const nextDetails = await agentApi.getAgent(agentId);
      setDetails(nextDetails);
      setSelectedRunId(
        (cur) => cur ?? nextDetails.agent.latest_run_id ?? null
      );
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
      return;
    }
    try {
      const [rd, rl, rp] = await Promise.all([
        agentApi.getRunDetails(agentId, selectedRunId),
        agentApi.getRunLogs(agentId, selectedRunId),
        agentApi.getRunPatch(agentId, selectedRunId).catch(() => ""),
      ]);
      setRunDetails(rd);
      setLogs(rl);
      setPatch(rp);
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

  // Real-time event listeners for live streaming
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
        if (p.agent_id === agentId) {
          void refreshAgent();
          setIsStreaming(p.status === "running");
        }
      });

      await add<LogEventPayload>("agent://log", (p) => {
        if (p.agent_id !== agentId) return;
        setIsStreaming(true);
        setLogs((cur) => {
          const key = p.stream as keyof RunLogs;
          const existing = cur[key] ?? "";
          const lines = existing.split("\n");
          // Enforce max line buffer from config
          if (lines.length > THEME_CONFIG.logStreamMaxLines) {
            const trimmed = lines.slice(-THEME_CONFIG.logStreamMaxLines).join("\n");
            return { ...cur, [key]: `${trimmed}${p.line}\n` };
          }
          return { ...cur, [key]: `${existing}${p.line}\n` };
        });
        scrollToLogBottom();
      });

      for (const ev of [
        "agent://run-started",
        "agent://run-completed",
        "agent://run-failed",
        "agent://run-cancelled",
        "agent://changes-collected",
      ]) {
        await add<Record<string, unknown>>(ev, (payload) => {
          void refreshAgent();
          void refreshRun();
          // Detect run lifecycle for streaming state
          if (ev === "agent://run-started") setIsStreaming(true);
          if (
            ev === "agent://run-completed" ||
            ev === "agent://run-failed" ||
            ev === "agent://run-cancelled"
          ) {
            const p = payload as { agent_id?: string };
            if (p.agent_id === agentId) setIsStreaming(false);
          }
        });
      }
    };

    void subscribe();
    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [agentId, refreshAgent, refreshRun, scrollToLogBottom]);

  const runAgent = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const job = await agentApi.runAgent(agentId);
      setSelectedRunId(job.run_id);
      setIsStreaming(true);
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
  const statusStyle =
    AGENTS_CONFIG.statusColors[agent?.status ?? "idle"] ??
    AGENTS_CONFIG.statusColors.idle;
  const isRunning = agent?.status === "running";

  const activeLogContent = logs[activeLogSource] || "";

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
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot} ${
                      isRunning ? "animate-status-pulse" : ""
                    }`}
                  />
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

      {/* Main content: tabs */}
      <Tabs defaultValue="logs" className="flex flex-col min-h-0">
        <TabsList className="w-fit border-border/30 bg-muted/30">
          <TabsTrigger value="logs" className="text-xs gap-1.5">
            <Terminal className="h-3 w-3" />
            Logs
            {isStreaming ? (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-log-blink ml-1" />
            ) : null}
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

        {/* ─── LOGS TAB ─── */}
        <TabsContent value="logs" className="mt-3">
          <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
            {/* Log source tabs */}
            <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-border/20">
              {(Object.keys(LOG_SOURCE_LABELS) as LogSource[]).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setActiveLogSource(source)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeLogSource === source
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {LOG_SOURCE_LABELS[source]}
                  {source === "stderr" && logs.stderr ? (
                    <AlertCircle className="h-3 w-3 ml-1 inline text-destructive" />
                  ) : null}
                </button>
              ))}
              {isStreaming ? (
                <div className="ml-auto flex items-center gap-1.5 text-[10px] text-emerald-400">
                  <Radio className="h-3 w-3 animate-status-pulse" />
                  LIVE
                </div>
              ) : null}
            </div>

            <ScrollArea className="h-[420px] w-full">
              <pre className="bg-muted/20 p-4 font-mono text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                {activeLogContent || (
                  <span className="text-muted-foreground/40">
                    {isStreaming
                      ? "Waiting for log output..."
                      : "Logs will stream here when the agent runs."}
                  </span>
                )}
                <div ref={logEndRef} />
              </pre>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* ─── CHANGES TAB ─── */}
        <TabsContent value="changes" className="mt-3">
          <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
            {runDetails?.changed_files.files.length ? (
              <Accordion type="multiple">
                {runDetails.changed_files.files.map((file) => (
                  <AccordionItem key={file.path} value={file.path}>
                    <AccordionTrigger className="px-4 py-2.5 hover:bg-muted/30">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs truncate text-foreground">
                          {file.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mr-2 text-xs">
                        <Badge variant="outline" className="text-[9px] px-1.5">
                          {file.status}
                        </Badge>
                        <span className="text-emerald-500 font-mono">+{file.additions}</span>
                        <span className="text-red-400 font-mono">-{file.deletions}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <DiffView patch={patch} filePath={file.path} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40">
                <FileDiff className="h-6 w-6 mb-2" />
                <p className="text-xs">No changes detected yet.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── COMMITS TAB ─── */}
        <TabsContent value="commits" className="mt-3">
          <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
            {runDetails?.commits.length ? (
              <Accordion type="single">
                {runDetails.commits.map((commit) => (
                  <AccordionItem key={commit.sha} value={commit.sha}>
                    <AccordionTrigger className="px-4 py-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="flex flex-col min-w-0 text-left">
                          <span className="text-xs font-medium truncate">
                            {commit.summary ?? "No message"}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {commit.sha.slice(0, 12)}
                          </span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <CommitDiffView
                        agentId={agentId ?? ""}
                        runId={selectedRunId ?? ""}
                        commitSha={commit.sha}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40">
                <GitBranch className="h-6 w-6 mb-2" />
                <p className="text-xs">No commits captured yet.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
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

/**
 * Renders a GitHub Desktop–style diff view for a specific file from the full patch.
 * Added lines get a green background, removed lines get a red background.
 */
function DiffView({ patch, filePath }: { patch: string; filePath: string }) {
  if (!patch) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground/50 italic">
        No patch data available.
      </p>
    );
  }

  const fileLines = extractFileDiff(patch, filePath);
  if (fileLines.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground/50 italic">
        No diff found for this file.
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-[400px] w-full">
      <div className="font-mono text-[11px] leading-5">
        {fileLines.map((line, i) => (
          <div
            key={i}
            className={`px-4 py-0 whitespace-pre-wrap break-all ${getDiffLineClass(line)}`}
          >
            {line}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/**
 * Shows per-file changes for a specific commit.
 * Uses the full patch and filters for commit-related changes.
 */
function CommitDiffView({
  agentId,
  runId,
  commitSha,
}: {
  agentId: string;
  runId: string;
  commitSha: string;
}) {
  const [commitPatch, setCommitPatch] = useState<string | null>(null);
  const [commitLoading, setCommitLoading] = useState(true);

  useEffect(() => {
    if (!agentId || !runId) return;
    setCommitLoading(true);
    agentApi
      .getRunPatch(agentId, runId)
      .then((p) => setCommitPatch(p))
      .catch(() => setCommitPatch(null))
      .finally(() => setCommitLoading(false));
  }, [agentId, runId]);

  if (commitLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (!commitPatch) {
    return (
      <p className="py-3 text-xs text-muted-foreground/50 italic">
        No patch data for commit {commitSha.slice(0, 8)}.
      </p>
    );
  }

  const files = extractFilesFromPatch(commitPatch);

  if (files.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground/50 italic">
        No file changes in this commit.
      </p>
    );
  }

  return (
    <Accordion type="multiple">
      {files.map((file) => (
        <AccordionItem key={file} value={`${commitSha}-${file}`}>
          <AccordionTrigger className="py-2 hover:bg-muted/20 text-xs">
            <FileCode className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="font-mono truncate">{file}</span>
          </AccordionTrigger>
          <AccordionContent>
            <DiffView patch={commitPatch} filePath={file} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

// ─── Diff Utility Helpers ───

function extractFileDiff(patch: string, filePath: string): string[] {
  const lines = patch.split("\n");
  const result: string[] = [];
  let capturing = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git")) {
      if (capturing) break;
      if (line.includes(`b/${filePath}`) || line.includes(filePath)) {
        capturing = true;
      }
      continue;
    }
    if (capturing) {
      result.push(line);
    }
  }

  return result;
}

function extractFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  const diffHeaderRegex = /^diff --git a\/.+ b\/(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = diffHeaderRegex.exec(patch)) !== null) {
    files.push(match[1]);
  }
  return files;
}

function getDiffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-added";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-removed";
  if (line.startsWith("@@")) return "diff-hunk";
  return "";
}
