import { RefreshCcw, Plus, Bot, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { CreateAgentDialog } from "./CreateAgentDialog";

export function AgentsView() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight mb-1">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Create, manage, and monitor your Sandcastle agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <RefreshCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <CreateAgentDialog>
            <Button size="sm" className="bg-white text-black hover:bg-zinc-200">
              <Plus className="h-4 w-4 mr-1.5" />
              New Agent
            </Button>
          </CreateAgentDialog>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
        <div 
          onClick={() => navigate("/agents/cracked-engineer")}
          className="rounded-xl border border-border/50 bg-[#121212] p-5 hover:border-border/80 transition-colors cursor-pointer group flex flex-col gap-4"
        >
          
          <div className="flex items-start justify-between">
            <div className="flex gap-3 items-center">
              <div className="bg-[#1e1e1e] border border-border/40 p-2.5 rounded-lg text-muted-foreground group-hover:text-foreground transition-colors">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <h3 className="font-bold text-[15px] leading-tight text-white mb-1">cracked engineer</h3>
                <div className="flex items-center text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3 mr-1" />
                  May 5
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 text-[11px] px-2.5 py-0.5 rounded-full font-medium">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500"></div>
              Ready
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">this guy can do anything</p>
          </div>

          <div className="mt-1">
            <p className="font-mono text-[10px] text-muted-foreground/60 truncate">
              /home/prasanna/.local/share/com.agent.castle/agents/cra..
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
