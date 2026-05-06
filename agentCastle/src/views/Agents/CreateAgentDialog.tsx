import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateAgentDialogProps {
  children: React.ReactNode;
}

export function CreateAgentDialog({ children }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] bg-[#0a0a0a] border-border/40 p-6 gap-6">
        <DialogHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="bg-[#1e1e1e] border border-border/40 p-2.5 rounded-lg text-foreground shrink-0 mt-0.5">
            <Bot className="h-6 w-6" />
          </div>
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-xl font-semibold tracking-tight">Create Agent</DialogTitle>
            <p className="text-sm text-muted-foreground leading-tight">
              Configure a new Sandcastle agent and its runtime environment.
            </p>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs text-muted-foreground">Agent Name</Label>
            <Input id="name" defaultValue="my-refactoring-agent" className="h-9 bg-[#121212] border-border/40" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-xs text-muted-foreground">Description</Label>
            <Textarea 
              id="description" 
              placeholder="Short summary shown on the agent card..." 
              className="resize-none h-16 bg-[#121212] border-border/40 placeholder:text-muted-foreground/50" 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo" className="text-xs text-muted-foreground">Target Repository Path</Label>
            <Input id="repo" defaultValue="/home/user/code/github.com/owner/repo (local clone)" className="h-9 bg-[#121212] border-border/40 text-muted-foreground/80" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template" className="text-xs text-muted-foreground">Template</Label>
            <Select defaultValue="blank">
              <SelectTrigger className="h-9 bg-[#121212] border-border/40">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank</SelectItem>
                <SelectItem value="react">React Refactor</SelectItem>
                <SelectItem value="python">Python Data</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sandbox" className="text-xs text-muted-foreground">Sandbox</Label>
              <Select defaultValue="docker">
                <SelectTrigger className="h-9 bg-[#121212] border-border/40">
                  <SelectValue placeholder="Select sandbox" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="docker">Docker</SelectItem>
                  <SelectItem value="podman">Podman</SelectItem>
                  <SelectItem value="local">Local Native</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider" className="text-xs text-muted-foreground">Agent Provider</Label>
              <Select defaultValue="claude">
                <SelectTrigger className="h-9 bg-[#121212] border-border/40">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude Code</SelectItem>
                  <SelectItem value="opencode">OpenCode</SelectItem>
                  <SelectItem value="pi">Pi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model" className="text-xs text-muted-foreground">Model</Label>
            <Input id="model" defaultValue="claude-opus-4-6" className="h-9 bg-[#121212] border-border/40" />
          </div>

          <div className="grid grid-cols-[1fr_100px] gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch" className="text-xs text-muted-foreground">Branch</Label>
              <Input id="branch" defaultValue="agent/name (auto)" className="h-9 bg-[#121212] border-border/40 text-muted-foreground/80" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iterations" className="text-xs text-muted-foreground">Iterations</Label>
              <Input id="iterations" type="number" defaultValue="1" className="h-9 bg-[#121212] border-border/40" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-xs text-muted-foreground">Prompt</Label>
            <Textarea 
              id="prompt" 
              placeholder="Describe the task for the agent..." 
              className="resize-none h-24 bg-[#121212] border-border/40 placeholder:text-muted-foreground/50" 
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-2">
          <Button variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button className="bg-white text-black hover:bg-zinc-200 px-6">
            Create Agent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
