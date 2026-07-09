"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Key, Activity, BarChart3, AlertCircle, Settings, ShieldAlert, HeartPulse, Sun, Moon, Monitor, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const navItems = [
  { name: "Overview", href: "/", icon: BarChart3 },
  { name: "Live Feed", href: "/logs", icon: Activity },
  { name: "Cooldowns", href: "/cooldown", icon: AlertCircle },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Error Log", href: "/errors", icon: ShieldAlert },
  { name: "Health", href: "/health", icon: HeartPulse },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <aside className="w-64 border-r bg-card/80 backdrop-blur-xl flex flex-col h-full shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10 relative">
      <div className="p-6 flex items-center gap-3 border-b border-border/50">
        <div className="bg-primary/10 p-2.5 rounded-xl text-primary shadow-inner">
          <Key className="w-5 h-5" />
        </div>
        <h1 className="font-bold text-lg leading-tight tracking-tight">
          Aerolink<br /><span className="text-muted-foreground font-medium text-sm">Key Manager</span>
        </h1>
      </div>
      
      <div className="px-4 pt-4">
        <button 
          onClick={() => {
            const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
            document.dispatchEvent(event);
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 hover:bg-muted rounded-lg border border-border/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <span>Search...</span>
          </div>
          <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-1.5 mt-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className={cn("w-4 h-4 transition-transform duration-200", !isActive && "group-hover:scale-110")} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-border/50 space-y-4">
        {mounted && (
          <div className="flex items-center justify-between p-1 bg-muted/50 rounded-lg border border-border/50">
            <button
              onClick={() => setTheme("light")}
              className={cn("flex-1 flex justify-center p-1.5 rounded-md transition-all", theme === "light" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTheme("system")}
              className={cn("flex-1 flex justify-center p-1.5 rounded-md transition-all", theme === "system" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={cn("flex-1 flex justify-center p-1.5 rounded-md transition-all", theme === "dark" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="text-xs text-muted-foreground text-center font-medium">
          Aerolink v1.0.0
        </div>
      </div>
    </aside>
  );
}
