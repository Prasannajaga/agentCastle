import { Bot, BarChart2, Settings, Moon, Sun, Castle } from "lucide-react";
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

const NAV_ITEMS = [
  { title: "Agents", url: "/", icon: Bot },
  { title: "Metrics", url: "/metrics", icon: BarChart2 },
  { title: "Settings", url: "/settings", icon: Settings },
] as const;

export function AppSidebar() {
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const isActive = (url: string) => {
    if (url === "/") return location.pathname === "/";
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          {/* Brand */}
          <div className="flex h-12 items-center px-4 gap-2.5 mb-6">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
              <Castle className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-[13px] leading-tight tracking-tight">
                AgentCastle
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                v0.1.0
              </span>
            </div>
          </div>

          {/* Navigation */}
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={<Link to={item.url} />}
                    isActive={isActive(item.url)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? (
            <>
              <Sun className="mr-2 h-3.5 w-3.5" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="mr-2 h-3.5 w-3.5" />
              Dark Mode
            </>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
