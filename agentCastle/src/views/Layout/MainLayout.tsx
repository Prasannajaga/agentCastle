import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Agents",
  "/metrics": "Metrics",
  "/settings": "Settings",
};

export function MainLayout() {
  const location = useLocation();

  const pageTitle = (() => {
    if (location.pathname.startsWith("/agents/")) return "Agent Detail";
    return (
      Object.entries(PAGE_TITLES).find(
        ([path]) => location.pathname === path
      )?.[1] ?? "Dashboard"
    );
  })();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/20">
          <AppSidebar />
          <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
            <header className="flex h-12 shrink-0 items-center gap-3 px-6 border-b border-border/40">
              <SidebarTrigger className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
              <div className="w-px h-4 bg-border/60" />
              <span className="text-xs font-medium text-muted-foreground tracking-wide">
                {pageTitle}
              </span>
            </header>
            <div className="flex-1 overflow-auto">
              <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-8">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
