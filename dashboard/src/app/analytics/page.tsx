"use client";

import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from "date-fns";

export default function AnalyticsPage() {
  const { data: requests } = useSWR(`${API_BASE_URL}/analytics/requests`, fetcher, { refreshInterval: 10000 });

  if (!requests) {
    return <div className="p-8 text-muted-foreground">Loading analytics...</div>;
  }

  // Aggregate requests by minute
  const minuteMap = new Map<string, { time: string; count: number; latencySum: number; errors: number }>();

  requests.forEach((req: any) => {
    // Group by minute (remove seconds/ms)
    const d = new Date(req.timestamp);
    d.setSeconds(0, 0);
    const key = d.toISOString();
    
    if (!minuteMap.has(key)) {
      minuteMap.set(key, { time: key, count: 0, latencySum: 0, errors: 0 });
    }
    
    const entry = minuteMap.get(key)!;
    entry.count += 1;
    entry.latencySum += req.latency_ms;
    if (!req.success) {
      entry.errors += 1;
    }
  });

  const chartData = Array.from(minuteMap.values()).map(v => ({
    time: format(new Date(v.time), 'HH:mm'),
    requests: v.count,
    errors: v.errors,
    avgLatency: Math.round(v.latencySum / v.count),
  }));

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance Analytics</h1>
        <p className="text-muted-foreground mt-1">Usage and latency trends over time</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requests per Minute</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line type="monotone" dataKey="requests" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average Latency (ms)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line type="monotone" dataKey="avgLatency" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
