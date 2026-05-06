import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Clock, Terminal, GitBranch, FileDiff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AgentDetailView() {
  const navigate = useNavigate();
  const { id } = useParams();

  // In a real app, you would fetch agent details based on the `id`.
  const agentName = id?.replace("-", " ") || "cracked engineer";

  return (
    <div className="flex flex-col gap-6 h-full max-h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border/40 pb-5">
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-fit text-muted-foreground hover:text-foreground -ml-2 h-8"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Agents
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-[#1e1e1e] border border-border/40 p-3 rounded-xl text-foreground">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight capitalize">{agentName}</h1>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                <span className="flex items-center">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  Started May 5
                </span>
                <span className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500"></div>
                  Ready
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="logs" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit border-border/50 bg-[#121212]">
          <TabsTrigger value="logs" className="text-xs">
            <Terminal className="h-3.5 w-3.5 mr-2" />
            Live Logs
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-xs">
            <FileDiff className="h-3.5 w-3.5 mr-2" />
            Changes
          </TabsTrigger>
          <TabsTrigger value="commits" className="text-xs">
            <GitBranch className="h-3.5 w-3.5 mr-2" />
            Commits
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 mt-4 relative">
          <TabsContent value="logs" className="absolute inset-0 m-0 border border-border/40 rounded-xl bg-[#0a0a0a]">
            <ScrollArea className="h-full w-full p-4">
              <div className="font-mono text-xs text-muted-foreground/80 space-y-2">
                <div className="text-blue-400">[info] Agent initialized.</div>
                <div>[debug] Loading workspace configuration...</div>
                <div>[debug] Attached to /home/prasanna/.local/share/com.agent.castle/agents/{id}</div>
                <div className="text-green-400">[success] Ready to accept commands.</div>
                {/* Simulated logs */}
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i}>[debug] Awaiting tasks... (poll {i + 1})</div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="changes" className="absolute inset-0 m-0 border border-border/40 rounded-xl bg-[#0a0a0a] p-6">
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileDiff className="h-8 w-8 mb-3 opacity-20" />
              <p className="text-sm">No local changes detected.</p>
            </div>
          </TabsContent>

          <TabsContent value="commits" className="absolute inset-0 m-0 border border-border/40 rounded-xl bg-[#0a0a0a] p-6">
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <GitBranch className="h-8 w-8 mb-3 opacity-20" />
              <p className="text-sm">No recent commits by this agent.</p>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
