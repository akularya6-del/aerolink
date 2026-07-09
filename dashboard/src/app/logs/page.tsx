"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pause, Play, Search } from "lucide-react";
import { format } from "date-fns";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [search, setSearch] = useState("");

  const { data: initialLogs } = useSWR(`${API_BASE_URL}/logs?limit=50`, fetcher);

  useEffect(() => {
    if (initialLogs && logs.length === 0) {
      setLogs(initialLogs);
    }
  }, [initialLogs, logs.length]);

  useEffect(() => {
    if (isPaused) return;

    const eventSource = new EventSource(`${API_BASE_URL}/events`);
    
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') return;

        if (event.type === 'proxy_request') {
          setLogs((prev) => [payload, ...prev].slice(0, 1000)); // keep last 1000 logs in memory
        }
      } catch (err) {}
    };

    // Need to listen to custom event names because AdminServer emits 'event: proxy_request'
    eventSource.addEventListener('proxy_request', (event: any) => {
      try {
        const payload = JSON.parse(event.data);
        setLogs((prev) => [payload, ...prev].slice(0, 1000));
      } catch (err) {}
    });

    return () => eventSource.close();
  }, [isPaused]);

  const filteredLogs = logs.filter(log => 
    log.key_id?.toLowerCase().includes(search.toLowerCase()) || 
    log.endpoint?.toLowerCase().includes(search.toLowerCase()) ||
    log.status_code?.toString().includes(search)
  );

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Request Feed</h1>
          <p className="text-muted-foreground mt-1">Real-time stream of proxy activity</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Filter logs..." 
              className="pl-8" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant={isPaused ? "default" : "outline"} onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
            {isPaused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead>Key ID</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log, idx) => (
                <TableRow key={log.id || `live-${idx}`}>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {format(new Date(log.timestamp), 'HH:mm:ss.SSS')}
                  </TableCell>
                  <TableCell className="font-medium text-xs">{log.key_id}</TableCell>
                  <TableCell className="font-mono text-xs">{log.endpoint}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={log.success ? "outline" : "destructive"} className={
                      log.success ? "border-green-500 text-green-500" : ""
                    }>
                      {log.status_code}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.latency_ms}ms
                  </TableCell>
                </TableRow>
              ))}
              {filteredLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No logs to display
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
