import { Moon, Sun, Monitor, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/views/providers/ThemeProvider";
import type { Theme } from "@/config/theme.config";

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
  { value: "system", label: "System", icon: <Monitor className="h-3.5 w-3.5" /> },
];

export function SettingsView() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6 animate-fade-up max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your application preferences.
        </p>
      </div>

      {/* Appearance */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Customize how AgentCastle looks on your device.
          </CardDescription>
        </CardHeader>
        <Separator className="opacity-30" />
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select a color scheme for the interface.
              </p>
            </div>
            <div className="flex items-center gap-1 bg-muted/30 rounded-lg border border-border/30 p-0.5">
              {THEME_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={theme === opt.value ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setTheme(opt.value)}
                  className={`text-xs gap-1.5 h-7 px-3 ${
                    theme === opt.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>
            Application information and version.
          </CardDescription>
        </CardHeader>
        <Separator className="opacity-30" />
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Application</span>
            <span className="font-medium">AgentCastle</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono text-xs text-muted-foreground">0.1.0</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Framework</span>
            <span className="font-mono text-xs text-muted-foreground">Tauri v2</span>
          </div>
        </CardContent>
      </Card>

      {/* Info banner */}
      <Alert className="flex items-start gap-3 border-border/20 bg-muted/20">
        <Info className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />
        <AlertDescription className="text-xs text-muted-foreground/60">
          Additional settings such as default providers, model preferences, and notification
          controls will be available in a future release.
        </AlertDescription>
      </Alert>
    </div>
  );
}
