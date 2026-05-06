import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "lucide-react";

export function MainLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/20">
          <AppSidebar />
          <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
            <header className="flex h-12 items-center gap-2 px-6 border-b border-border/40">
              <SidebarTrigger className="h-4 w-4" />
              <div className="w-px h-4 bg-border/60 mx-1"></div>
              <div className="flex items-center text-xs text-muted-foreground">
                <Layout className="h-3.5 w-3.5 mr-2" />
                Dashboard
              </div>
            </header>
            <div className="flex-1 p-8 overflow-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
