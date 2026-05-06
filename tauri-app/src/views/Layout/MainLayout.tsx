import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function MainLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground font-sans">
          <AppSidebar />
          <main className="flex-1 flex flex-col relative overflow-hidden">
            <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-6 lg:h-[60px]">
              <SidebarTrigger />
              <div className="w-full flex-1">
                {/* Search or breadcrumbs can go here */}
              </div>
            </header>
            <div className="flex-1 p-6 overflow-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
