"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Cpu, Server, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function HealthPage() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE_URL}/events`);
    
    eventSource.addEventListener('health_update', (event: any) => {
      try {
        setHealth(JSON.parse(event.data));
      } catch (err) {}
    });

    return () => eventSource.close();
  }, []);

  if (!health) return <div className="p-8 text-muted-foreground">Waiting for health telemetry...</div>;

  const memMb = Math.round(health.memory.rss / 1024 / 1024);
  const uptimeStr = formatDistanceToNow(Date.now() - health.uptime * 1000);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-blue-400">System Health</h1>
        <p className="text-muted-foreground mt-1">Live infrastructure telemetry</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memMb} MB</div>
            <p className="text-xs text-muted-foreground">RSS Resident Set Size</p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Process Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uptimeStr}</div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">CPU Time (User)</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(health.cpu.user / 1000)} ms</div>
          </CardContent>
        </Card>
        
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Node.js Status</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">Healthy</div>
            <p className="text-xs text-muted-foreground">Event loop active</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
