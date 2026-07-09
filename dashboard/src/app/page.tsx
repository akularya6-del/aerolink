"use client";

import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, XCircle, AlertTriangle, PlayCircle, CheckCircle, Clock, Cpu, Server, BarChart2, Database, DollarSign, PieChart as PieChartIcon, Zap, ShieldCheck, FlaskConical, Loader2, CircleCheck, CircleX } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, AreaChart, Area } from 'recharts';
import { cn } from "@/lib/utils";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { RadarWidget } from "@/components/RadarWidget";

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

// Animation Variants
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

function UpstreamStatusBadge({ status }: { status: string }) {
  if (status === 'offline') {
    return (
      <div className="flex items-center gap-3 mb-2" title="The upstream provider is currently returning 500/503 errors and is unreachable.">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)]"></span>
        </span>
        <span className="text-xs font-semibold tracking-wider text-red-500 uppercase hacker-text">Provider Offline</span>
      </div>
    );
  }
  
  if (status === 'degraded') {
    return (
      <div className="flex items-center gap-3 mb-2" title="The upstream provider is experiencing intermittent failures.">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" style={{ animationDuration: '2s' }}></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)]"></span>
        </span>
        <span className="text-xs font-semibold tracking-wider text-yellow-500 uppercase hacker-text">Degraded</span>
      </div>
    );
  }

  // operational (or null if initializing)
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
      </span>
      <span className="text-xs font-semibold tracking-wider text-green-500 uppercase hacker-text">System Online</span>
    </div>
  );
}

export default function OverviewPage() {
  const { data: stats, mutate: mutateStats } = useSWR(`${API_BASE_URL}/stats`, fetcher, { refreshInterval: 5000 });
  const { data: keys, mutate: mutateKeys } = useSWR(`${API_BASE_URL}/keys`, fetcher, { refreshInterval: 5000 });
  const { data: modelUsage } = useSWR(`${API_BASE_URL}/analytics/models`, fetcher, { refreshInterval: 10000 });
  const { data: requestsData } = useSWR(`${API_BASE_URL}/analytics/requests`, fetcher, { refreshInterval: 10000 });

  const [liveLogs, setLiveLogs] = useState<any[]>([]);
  const [totalLogEvents, setTotalLogEvents] = useState(0); // Used to trigger radar pulses
  const [health, setHealth] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  const runKeyTest = useCallback(async () => {
    setIsTesting(true);
    setTestResults(null);
    try {
      const res = await fetch(`${API_BASE_URL}/test-keys`, { method: 'POST' });
      const data = await res.json();
      setTestResults(data);
    } catch (err: any) {
      setTestResults({ error: err.message });
    } finally {
      setIsTesting(false);
    }
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    const eventSource = new EventSource(`${API_BASE_URL}/events`);
    
    eventSource.onmessage = (event) => {
      if (timeout) return;
      timeout = setTimeout(() => {
        mutateStats();
        mutateKeys();
        timeout = null;
      }, 1000);
    };

    eventSource.addEventListener('proxy_request', (event: any) => {
      try {
        const payload = JSON.parse(event.data);
        setLiveLogs((prev) => [payload, ...prev].slice(0, 10)); // Keep last 10 logs
        setTotalLogEvents((prev) => prev + 1);
      } catch (err) {}
    });

    eventSource.addEventListener('health_update', (event: any) => {
      try {
        setHealth(JSON.parse(event.data));
      } catch (err) {}
    });

    return () => {
      eventSource.close();
      if (timeout) clearTimeout(timeout);
    };
  }, [mutateStats, mutateKeys]);

  if (!stats || !keys || !mounted) {
    return <div className="h-screen w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-muted-foreground animate-pulse">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium tracking-widest uppercase">Initializing Command Center</p>
      </div>
    </div>;
  }

  // Aggregations for global metrics
  const totalRequests = keys.reduce((acc: number, key: any) => acc + (key.requests || 0), 0);
  const totalSuccesses = keys.reduce((acc: number, key: any) => acc + (key.successes || 0), 0);
  const successRate = totalRequests > 0 ? ((totalSuccesses / totalRequests) * 100) : 0;
  
  let globalTotalLatencyMs = 0;
  keys.forEach((key: any) => {
    globalTotalLatencyMs += key.totalLatencyMs || 0;
  });
  const globalAverageLatency = totalSuccesses > 0 ? (globalTotalLatencyMs / totalSuccesses) : 0;

  const totalInputTokens = stats.totalInputTokens || 0;
  const totalOutputTokens = stats.totalOutputTokens || 0;
  const estimatedCost = ((totalInputTokens / 1_000_000) * 3.0) + ((totalOutputTokens / 1_000_000) * 15.0);

  const sparklineData = requestsData ? requestsData.slice(-60).map((r: any, i: number) => ({
    i,
    latency: r.latency_ms,
    req: 1
  })) : [];

  const validKeys = keys.filter((k: any) => k.requests > 10);
  const fastestKey = validKeys.length > 0 ? [...validKeys].sort((a, b) => (a.totalLatencyMs/a.successes) - (b.totalLatencyMs/b.successes))[0] : null;
  const mostUsedKey = keys.length > 0 ? [...keys].sort((a, b) => b.requests - a.requests)[0] : null;

  return (
    <motion.div 
      className="p-6 md:p-10 space-y-10 max-w-[1600px] mx-auto min-h-screen"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Header Section */}
      <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="space-y-1">
          <UpstreamStatusBadge status={stats.upstreamStatus || 'operational'} />
          <h1 className="text-4xl font-extrabold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground">Monitor real-time proxy traffic, telemetry, and node status.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {health && (
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground glass px-4 py-2 rounded-full">
              <div className="flex items-center gap-1.5" title="Uptime">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
                {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5" title="Memory">
                <Cpu className="h-3.5 w-3.5 text-orange-500" />
                {Math.round(health.memory.rss / 1024 / 1024)}MB
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Primary Metrics */}
      <motion.div variants={containerVariants} className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <motion.div variants={itemVariants}>
          <Card className="glass hover-lift border-t-4 border-t-blue-500 overflow-hidden relative">
            <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Total Requests</CardTitle>
              <div className="p-2 bg-blue-500/10 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                <BarChart2 className="h-4 w-4 text-blue-500" />
              </div>
            </CardHeader>
            <CardContent className="z-10 relative">
              <div className="text-4xl font-black">
                <AnimatedCounter value={totalRequests} />
              </div>
            </CardContent>
            {sparklineData.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-16 opacity-30 pointer-events-none z-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineData}>
                    <Area type="monotone" dataKey="req" stroke="none" fill="url(#colorBlue)" fillOpacity={1} />
                    <defs>
                      <linearGradient id="colorBlue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="glass hover-lift border-t-4 border-t-emerald-500 relative">
            <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Success Rate</CardTitle>
              <div className="p-2 bg-emerald-500/10 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent className="z-10 relative">
              <div className="text-4xl font-black flex items-baseline">
                <AnimatedCounter value={successRate} format={(val) => val.toFixed(1)} />
                <span className="text-2xl">%</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="glass hover-lift border-t-4 border-t-indigo-500 overflow-hidden relative">
            <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Global Latency</CardTitle>
              <div className="p-2 bg-indigo-500/10 rounded-full shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                <Activity className="h-4 w-4 text-indigo-500" />
              </div>
            </CardHeader>
            <CardContent className="z-10 relative">
              <div className="text-4xl font-black flex items-baseline gap-1">
                <AnimatedCounter value={globalAverageLatency} />
                <span className="text-sm font-medium text-muted-foreground">ms</span>
              </div>
            </CardContent>
            {sparklineData.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-16 opacity-30 pointer-events-none z-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineData}>
                    <Area type="step" dataKey="latency" stroke="none" fill="url(#colorIndigo)" fillOpacity={1} />
                    <defs>
                      <linearGradient id="colorIndigo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="glass hover-lift border-t-4 border-t-rose-500 relative">
            <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Est. Cost</CardTitle>
              <div className="p-2 bg-rose-500/10 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.3)]">
                <DollarSign className="h-4 w-4 text-rose-500" />
              </div>
            </CardHeader>
            <CardContent className="z-10 relative">
              <div className="text-4xl font-black text-rose-500/90 flex items-baseline">
                $
                <AnimatedCounter value={estimatedCost} format={(val) => val.toFixed(2)} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                <AnimatedCounter value={totalInputTokens + totalOutputTokens} /> tokens
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <motion.div variants={containerVariants} className="grid gap-6 grid-cols-1 xl:grid-cols-3">
        {/* Main Content Area */}
        <div className="xl:col-span-2 space-y-6">
          
          <motion.div variants={itemVariants} className="grid gap-6 md:grid-cols-2">
            <div className="animated-border rounded-xl">
              <Card className="glass bg-gradient-to-br from-background to-muted/20 relative z-10 h-full border-0 rounded-xl">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                    <Zap className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Fastest API Key</p>
                    {fastestKey ? (
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold font-mono">{fastestKey.id}</span>
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">{Math.round(fastestKey.totalLatencyMs/fastestKey.successes)}ms avg</Badge>
                      </div>
                    ) : <span className="text-sm italic text-muted-foreground">Not enough data</span>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="animated-border rounded-xl" style={{ '--angle': '180deg' } as any}>
              <Card className="glass bg-gradient-to-br from-background to-muted/20 relative z-10 h-full border-0 rounded-xl">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                    <ShieldCheck className="h-6 w-6 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Heavy Duty Key</p>
                    {mostUsedKey ? (
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold font-mono">{mostUsedKey.id}</span>
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500">{mostUsedKey.requests.toLocaleString()} reqs</Badge>
                      </div>
                    ) : <span className="text-sm italic text-muted-foreground">Not enough data</span>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="glass shadow-2xl shadow-black/5 dark:shadow-black/40 border-border/50">
              <CardHeader className="border-b border-border/50 bg-muted/20 px-6 py-5">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">Node Pool</CardTitle>
                    <CardDescription className="mt-1">Individual performance metrics per API key</CardDescription>
                  </div>
                  <div className="flex gap-2 text-sm items-center">
                    <Badge variant="outline" className="bg-background glass"><span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] mr-2" />{stats.available} Available</Badge>
                    <Badge variant="outline" className="bg-background glass"><span className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)] mr-2" />{stats.busy} Busy</Badge>
                    <Badge variant="outline" className="bg-background glass"><span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] mr-2" />{stats.cooling} Cooling</Badge>
                    <button
                      onClick={runKeyTest}
                      disabled={isTesting}
                      className={cn(
                        "ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-200",
                        isTesting
                          ? "bg-blue-500/20 text-blue-400 cursor-wait"
                          : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] cursor-pointer"
                      )}
                    >
                      {isTesting ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing...</>
                      ) : (
                        <><FlaskConical className="h-3.5 w-3.5" /> Test All Keys</>
                      )}
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-transparent">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6 h-12 font-semibold">Key ID</TableHead>
                        <TableHead className="font-semibold">Secret</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="text-right font-semibold">Reqs</TableHead>
                        <TableHead className="text-right font-semibold">Fails</TableHead>
                        <TableHead className="text-right font-semibold pr-6">Tokens (In/Out)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keys.map((key: any) => (
                        <TableRow key={key.id} className="group transition-colors hover:bg-muted/30 cursor-default">
                          <TableCell className="pl-6 font-medium group-hover:text-primary transition-colors">{key.id}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">{key.apiKey}</TableCell>
                          <TableCell>
                            {(() => {
                              const testFailed = testResults?.results?.find((r: any) => r.id === key.id && r.status === 'error');
                              const displayStatus = testFailed ? 'unavailable' : key.status;
                              return (
                                <Badge variant="secondary" className={cn(
                                  "px-2.5 py-0.5 rounded-full font-medium text-[11px] uppercase tracking-wider border-0 shadow-sm",
                                  displayStatus === 'available' ? 'bg-green-500/10 text-green-500' :
                                  displayStatus === 'unavailable' ? 'bg-orange-500/10 text-orange-500' :
                                  displayStatus === 'busy' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
                                  displayStatus === 'cooling' ? 'bg-red-500/10 text-red-500' : 'bg-slate-500/10 text-slate-500'
                                )}>
                                  {displayStatus}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{key.requests.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={cn(key.failures > 0 && "text-red-500 font-medium")}>{key.failures.toLocaleString()}</span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums text-xs pr-6">
                            {(key.inputTokens || 0).toLocaleString()} <span className="opacity-40 px-1">/</span> {(key.outputTokens || 0).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>

              {/* Test Results Panel */}
              <AnimatePresence>
                {testResults && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-border/50 bg-muted/10 px-6 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <FlaskConical className="h-4 w-4 text-cyan-400" />
                          <span className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">Live Key Test Results</span>
                        </div>
                        {testResults.summary && (
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-green-400 font-mono">{testResults.summary.working} PASS</span>
                            <span className="text-red-400 font-mono">{testResults.summary.failed} FAIL</span>
                            <span className="text-muted-foreground">Tested at {new Date(testResults.testedAt).toLocaleTimeString()}</span>
                            <button onClick={() => setTestResults(null)} className="text-muted-foreground hover:text-white transition-colors ml-1"><XCircle className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {testResults.error ? (
                        <div className="text-red-400 text-sm">{testResults.error}</div>
                      ) : (
                        <div className="grid gap-2">
                          {testResults.results?.map((r: any) => (
                            <div key={r.id} className={cn(
                              "flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm transition-all",
                              r.status === 'ok'
                                ? 'bg-green-500/5 border-green-500/20'
                                : 'bg-red-500/5 border-red-500/20'
                            )}>
                              <div className="flex items-center gap-3">
                                {r.status === 'ok' ? (
                                  <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
                                ) : (
                                  <CircleX className="h-4 w-4 text-red-500 shrink-0" />
                                )}
                                <span className="font-medium">{r.id}</span>
                                <span className="font-mono text-xs text-muted-foreground">{r.apiKey}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                {r.httpStatus && (
                                  <span className={cn(
                                    "font-mono text-xs px-2 py-0.5 rounded-full",
                                    r.status === 'ok' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                  )}>
                                    HTTP {r.httpStatus}
                                  </span>
                                )}
                                {r.latencyMs !== undefined && (
                                  <span className="font-mono text-xs text-muted-foreground">{r.latencyMs}ms</span>
                                )}
                                <span className={cn(
                                  "text-xs max-w-[300px] truncate",
                                  r.status === 'ok' ? 'text-green-400' : 'text-red-400'
                                )} title={r.message}>
                                  {r.message}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </motion.div>
        </div>

        {/* Right Sidebar Widgets */}
        <div className="space-y-6">
          <motion.div variants={itemVariants}>
            <Card className="glass border-border/50 flex flex-col min-h-[450px] overflow-hidden relative bg-[#0a0a0a] dark:bg-black text-green-500 font-mono">
              <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(34, 197, 94, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 197, 94, 0.2) 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
              <CardHeader className="border-b border-green-900/50 bg-black/40 px-6 py-4 z-10">
                <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-green-500 hacker-text">
                  <TerminalIcon className="h-4 w-4" />
                  Live Proxy Console
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-4 z-10 flex flex-col relative">
                
                {/* Embedded Radar Widget */}
                <div className="absolute top-4 right-4 w-24 h-24 opacity-60">
                  <RadarWidget logCount={totalLogEvents} />
                </div>

                {liveLogs.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center text-sm text-green-700 gap-3">
                    <span className="animate-pulse hacker-text">Awaiting transmission..._</span>
                  </div>
                ) : (
                  <div className="space-y-2 mt-auto">
                    <AnimatePresence mode="popLayout">
                      {liveLogs.map((log, idx) => (
                        <motion.div 
                          key={log.timestamp + idx} 
                          initial={{ opacity: 0, x: -20, height: 0 }}
                          animate={{ opacity: 1, x: 0, height: "auto" }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                          className="flex flex-col gap-1 py-2 text-xs border-b border-green-900/30"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold hacker-text text-green-400">[{log.key_id}]</span>
                            <span className={cn("px-1.5 rounded-sm", log.success ? "bg-green-900 text-green-400" : "bg-red-900 text-red-400 hacker-text")}>
                              {log.status_code}
                            </span>
                          </div>
                          <div className="flex items-center justify-between opacity-70 text-[10px]">
                            <span className="truncate max-w-[200px]">{log.endpoint.split('?')[0]}</span>
                            <span>{log.latency_ms}ms</span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="glass shadow-xl shadow-black/5 dark:shadow-black/20 border-border/50">
              <CardHeader className="border-b border-border/50 bg-muted/20 px-6 py-5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PieChartIcon className="h-5 w-5 text-indigo-500" />
                  Model Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 h-[280px]">
                {(!modelUsage || modelUsage.length === 0) ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">Gathering telemetry...</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={modelUsage}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="count"
                        nameKey="model"
                        stroke="none"
                      >
                        {modelUsage.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ color: 'var(--foreground)', fontSize: '13px', fontWeight: 500 }}
                        formatter={(value, name) => [value, String(name).split('/').pop()]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TerminalIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>
    </svg>
  )
}
