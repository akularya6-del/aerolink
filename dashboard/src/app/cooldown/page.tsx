"use client";

import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";

export default function CooldownPage() {
  const { data: keys, mutate } = useSWR(`${API_BASE_URL}/keys`, fetcher, { refreshInterval: 1000 });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!keys) return <div className="p-8 text-muted-foreground">Loading cooldowns...</div>;

  const coolingKeys = keys.filter((k: any) => k.status === 'cooling' && k.cooldownUntil);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-yellow-500">Active Cooldowns</h1>
        <p className="text-muted-foreground mt-1">Keys currently paused due to rate limits</p>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead>Key ID</TableHead>
                <TableHead>Remaining Time</TableHead>
                <TableHead className="w-[300px]">Progress</TableHead>
                <TableHead>Ready At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coolingKeys.map((key: any) => {
                // assume standard cooldown duration is 60s for the progress bar max
                const remaining = Math.max(0, key.cooldownUntil - now);
                const progress = Math.min(100, Math.max(0, 100 - (remaining / 60000) * 100));
                
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium text-xs">{key.id}</TableCell>
                    <TableCell className="font-mono text-yellow-400">
                      {remaining > 0 ? formatDistanceToNow(key.cooldownUntil, { addSuffix: true }) : 'Ready'}
                    </TableCell>
                    <TableCell>
                      <Progress value={progress} className="h-2 bg-muted/50 [&>div]:bg-yellow-500" />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(key.cooldownUntil).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                );
              })}
              {coolingKeys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No keys are currently in cooldown. All good!
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
