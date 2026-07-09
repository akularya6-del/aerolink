"use client";

import useSWR from "swr";
import { API_BASE_URL, fetcher } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function ErrorsPage() {
  const { data: errors } = useSWR(`${API_BASE_URL}/errors?limit=100`, fetcher, { refreshInterval: 10000 });

  if (!errors) {
    return <div className="p-8 text-muted-foreground">Loading errors...</div>;
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-red-500">Error Log</h1>
        <p className="text-muted-foreground mt-1">System and upstream API failures</p>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 border-red-500/20">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead>Key ID</TableHead>
                <TableHead>Error Message</TableHead>
                <TableHead>Request ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.map((error: any) => (
                <TableRow key={error.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {format(new Date(error.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                  </TableCell>
                  <TableCell className="font-medium text-xs">{error.key_id}</TableCell>
                  <TableCell className="text-red-400 text-sm max-w-[400px] truncate" title={error.error_message}>
                    {error.error_message}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{error.request_id || '-'}</TableCell>
                </TableRow>
              ))}
              {errors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No errors found. System is healthy.
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
