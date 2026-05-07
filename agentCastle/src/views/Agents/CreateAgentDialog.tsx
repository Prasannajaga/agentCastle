import { useState, useCallback, type ReactElement } from "react";
import {
  Bot,
  Loader2,
  Folder,
  Settings2,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
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
import { Badge } from "@/components/ui/badge";
import {
  agentApi,
  type CreateAgentPayload,
  type SandboxProviderName,
  getErrorMessage,
} from "@/lib/agents";
import { AGENTS_CONFIG } from "@/config/agents.config";

interface CreateAgentDialogProps {
  children: React.ReactNode;
  onCreated?: (agentId: string) => void;
}

const STEPS = [
  { id: "basics", label: "Basics", icon: Bot },
  { id: "runtime", label: "Runtime", icon: Settings2 },
  { id: "prompt", label: "Prompt", icon: MessageSquare },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function getEmptyForm() {
  return {
    name: "",
    description: "",
    target_repo_path: "",
    sandbox_provider: AGENTS_CONFIG.defaultSandboxProvider,
    agent_provider: AGENTS_CONFIG.defaultAgentProvider,
    model: AGENTS_CONFIG.defaultModel,
    max_iterations: AGENTS_CONFIG.defaultMaxIterations,
    branch: "",
    prompt: "",
  };
}

export function CreateAgentDialog({ children, onCreated }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(getEmptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("basics");

  const resetForm = useCallback(() => {
    setForm(getEmptyForm());
    setError(null);
    setStep("basics");
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) resetForm();
    },
    [resetForm]
  );

  const updateField = <K extends keyof ReturnType<typeof getEmptyForm>>(
    field: K,
    value: ReturnType<typeof getEmptyForm>[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const currentStepIndex = STEPS.findIndex((s) => s.id === step);

  const goNext = () => {
    if (step === "basics") {
      if (!form.name.trim()) {
        setError("Agent name is required.");
        return;
      }
      if (!form.target_repo_path.trim()) {
        setError("Target repository path is required.");
        return;
      }
      setError(null);
      setStep("runtime");
    } else if (step === "runtime") {
      setError(null);
      setStep("prompt");
    }
  };

  const goBack = () => {
    setError(null);
    if (step === "runtime") setStep("basics");
    else if (step === "prompt") setStep("runtime");
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("Agent name is required.");
      return;
    }
    if (!form.target_repo_path.trim()) {
      setError("Target repository path is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload: CreateAgentPayload = {
        name: form.name.trim(),
        target_repo_path: form.target_repo_path.trim(),
        sandbox_provider: form.sandbox_provider as SandboxProviderName,
        agent_provider: form.agent_provider,
        model: form.model.trim() || AGENTS_CONFIG.defaultModel,
        prompt: { type: "inline", value: form.prompt },
        max_iterations: Number(form.max_iterations) || AGENTS_CONFIG.defaultMaxIterations,
        branch: form.branch.trim() || null,
      };
      const created = await agentApi.createAgent(payload);
      setOpen(false);
      resetForm();
      onCreated?.(created.agent.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={children as ReactElement} />
      <DialogContent className="sm:max-w-[560px] bg-card border-border/30 p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/20">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground p-2 rounded-lg shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Create Agent
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Configure a new Sandcastle agent and its runtime environment.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const isActive = s.id === step;
              const isCompleted = i < currentStepIndex;
              const Icon = s.icon;
              return (
                <div key={s.id} className="flex items-center gap-1 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (isCompleted) {
                        setError(null);
                        setStep(s.id);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                      isActive
                        ? "bg-secondary text-foreground"
                        : isCompleted
                          ? "text-foreground/70 hover:bg-muted/50 cursor-pointer"
                          : "text-muted-foreground/40 cursor-default"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 ? (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Form body */}
        <div className="px-6 py-4 flex flex-col gap-4 min-h-[280px]">
          {/* Error */}
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {/* Step: Basics */}
          {step === "basics" ? (
            <>
              <div className="space-y-1.5">
                <Label
                  htmlFor="create-name"
                  className="text-[11px] text-muted-foreground uppercase tracking-wider"
                >
                  Agent Name
                </Label>
                <Input
                  id="create-name"
                  placeholder="my-refactoring-agent"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="h-9 bg-background border-border/30 focus-visible:border-foreground/30"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="create-repo"
                  className="text-[11px] text-muted-foreground uppercase tracking-wider"
                >
                  Target Repository
                </Label>
                <div className="relative">
                  <Folder className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                  <Input
                    id="create-repo"
                    placeholder="/home/user/code/repo"
                    value={form.target_repo_path}
                    onChange={(e) => updateField("target_repo_path", e.target.value)}
                    className="h-9 bg-background border-border/30 font-mono text-xs pl-9 focus-visible:border-foreground/30"
                  />
                </div>
              </div>
            </>
          ) : null}

          {/* Step: Runtime */}
          {step === "runtime" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    Sandbox
                  </Label>
                  <Select
                    value={form.sandbox_provider}
                    onValueChange={(v) => v && updateField("sandbox_provider", v)}
                  >
                    <SelectTrigger className="h-9 bg-background border-border/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENTS_CONFIG.sandboxProviders.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    Provider
                  </Label>
                  <Select
                    value={form.agent_provider}
                    onValueChange={(v) => v && updateField("agent_provider", v)}
                  >
                    <SelectTrigger className="h-9 bg-background border-border/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENTS_CONFIG.agentProviders.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="create-model"
                  className="text-[11px] text-muted-foreground uppercase tracking-wider"
                >
                  Model
                </Label>
                <Input
                  id="create-model"
                  value={form.model}
                  onChange={(e) => updateField("model", e.target.value)}
                  className="h-9 bg-background border-border/30 focus-visible:border-foreground/30"
                />
              </div>

              <div className="grid grid-cols-[1fr_90px] gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="create-branch"
                    className="text-[11px] text-muted-foreground uppercase tracking-wider"
                  >
                    Branch
                  </Label>
                  <Input
                    id="create-branch"
                    placeholder="agent/name (auto)"
                    value={form.branch}
                    onChange={(e) => updateField("branch", e.target.value)}
                    className="h-9 bg-background border-border/30 text-xs focus-visible:border-foreground/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="create-iters"
                    className="text-[11px] text-muted-foreground uppercase tracking-wider"
                  >
                    Iterations
                  </Label>
                  <Input
                    id="create-iters"
                    type="number"
                    min={1}
                    value={form.max_iterations}
                    onChange={(e) => updateField("max_iterations", Number(e.target.value))}
                    className="h-9 bg-background border-border/30 focus-visible:border-foreground/30"
                  />
                </div>
              </div>
            </>
          ) : null}

          {/* Step: Prompt */}
          {step === "prompt" ? (
            <>
              <div className="space-y-1.5 flex-1 flex flex-col">
                <Label
                  htmlFor="create-prompt"
                  className="text-[11px] text-muted-foreground uppercase tracking-wider"
                >
                  Agent Prompt
                </Label>
                <Textarea
                  id="create-prompt"
                  placeholder="Describe the task for the agent..."
                  value={form.prompt}
                  onChange={(e) => updateField("prompt", e.target.value)}
                  className="resize-none flex-1 min-h-[160px] bg-background border-border/30 placeholder:text-muted-foreground/40 focus-visible:border-foreground/30"
                />
              </div>

              {/* Summary preview */}
              {form.name ? (
                <div className="rounded-lg border border-border/20 bg-muted/15 p-3 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
                    Summary
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <Badge variant="secondary">{form.name}</Badge>
                    <Badge variant="outline">{form.agent_provider}</Badge>
                    <Badge variant="outline">{form.sandbox_provider}</Badge>
                    <Badge variant="outline">{form.model}</Badge>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-between gap-2 px-6 py-4 border-t border-border/20 bg-muted/10">
          <div>
            {currentStepIndex > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
            )}
          </div>
          <div>
            {step !== "prompt" ? (
              <Button
                size="sm"
                onClick={goNext}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-5"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={busy}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-5"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Create Agent
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
