"use client";

import * as React from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, BarChart3, HeartPulse, ShieldAlert, Settings, Key } from "lucide-react";
import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { data: keys } = useSWR(`${API_BASE_URL}/keys`, fetcher);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 pt-[10vh] animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={() => setOpen(false)} />
      
      <Command 
        className="relative w-full max-w-2xl bg-card border border-border shadow-2xl rounded-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <div className="flex items-center border-b border-border px-3">
          <SearchIcon className="w-5 h-5 text-muted-foreground mr-2 shrink-0" />
          <Command.Input 
            autoFocus 
            placeholder="Search keys, navigate pages..." 
            className="flex h-14 w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none border-none text-sm"
          />
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          <Command.Group heading="Navigation" className="px-2 text-xs font-medium text-muted-foreground py-2">
            {[
              { name: "Overview Dashboard", href: "/", icon: BarChart3 },
              { name: "Live Request Feed", href: "/logs", icon: Activity },
              { name: "Cooldown Management", href: "/cooldown", icon: AlertCircle },
              { name: "Error Logs", href: "/errors", icon: ShieldAlert },
              { name: "System Health", href: "/health", icon: HeartPulse },
              { name: "Settings", href: "/settings", icon: Settings },
            ].map((item) => (
              <Command.Item
                key={item.href}
                onSelect={() => {
                  router.push(item.href);
                  setOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2.5 mt-1 text-sm text-foreground rounded-md cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground transition-colors"
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Command.Item>
            ))}
          </Command.Group>

          {keys && keys.length > 0 && (
            <Command.Group heading="API Keys" className="px-2 text-xs font-medium text-muted-foreground py-2 border-t border-border mt-2">
              {keys.map((key: any) => (
                <Command.Item
                  key={key.id}
                  onSelect={() => {
                    // Navigate to overview and maybe highlight key (future feature)
                    router.push("/");
                    setOpen(false);
                  }}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 mt-1 text-sm text-foreground rounded-md cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Key className="w-4 h-4" />
                    <span>{key.id}</span>
                  </div>
                  <span className="font-mono text-xs opacity-60">{key.apiKey}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function SearchIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  )
}
