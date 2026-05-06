import { Bot, BarChart2, Settings, Moon, Sun, MonitorDot } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../providers/ThemeProvider";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const items = [
  {
    title: "Agents",
    url: "/",
    icon: Bot,
  },
  {
    title: "Metrics",
    url: "/metrics",
    icon: BarChart2,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <div className="flex h-14 items-center px-4 gap-3 mb-4 mt-2">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
              <MonitorDot className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm leading-tight tracking-tight">AgentCastle</span>
              <span className="text-[10px] text-muted-foreground leading-tight">Agent Orchestrator</span>
            </div>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={<Link to={item.url} />} isActive={location.pathname === item.url}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-full justify-start text-muted-foreground hover:text-foreground">
          {theme === "dark" ? (
            <>
              <Sun className="mr-2 h-4 w-4" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="mr-2 h-4 w-4" />
              Dark Mode
            </>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
