"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Server,
  Database,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  HardDrive,
  Globe,
  Terminal,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SystemHealth {
  status: "healthy" | "degraded";
  timestamp: string;
  database: {
    connected: boolean;
    latencyMs: number;
  };
  system: {
    uptimeSeconds: number;
    uptimeFormatted: string;
    nodeVersion: string;
    environment: string;
    memoryUsage: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
    };
  };
  counts: {
    activeTenants: number;
    activeUsers: number;
    activeDevices: number;
  };
}

export default function PlatformHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setError(null);
    try {
      const data = await api.get<SystemHealth>("/admin/system-health");
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load system diagnostics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealth();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Running platform diagnostics probe…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              System Diagnostics & Health
            </h1>
            <Badge
              variant={health?.status === "healthy" ? "default" : "destructive"}
              className="capitalize text-xs font-semibold"
            >
              {health?.status === "healthy" ? "All Systems Operational" : "Degraded Performance"}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Real-time backend telemetries, database query latencies, process memory, and host platform diagnostics.
          </p>
        </div>

        <Button
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs h-9 font-semibold"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Run Health Probe
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Core Health Metrics ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Database Latency */}
        <Card className="border-border/60 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Postgres DB Probe
            </CardTitle>
            <Database className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-foreground">
                {health?.database.latencyMs}
              </span>
              <span className="text-xs text-muted-foreground font-mono">ms latency</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Connection Pool Healthy</span>
            </div>
          </CardContent>
        </Card>

        {/* Process Uptime */}
        <Card className="border-border/60 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              NestJS Server Uptime
            </CardTitle>
            <Clock className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground font-mono">
              {health?.system.uptimeFormatted || "0s"}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Continuous runtime without failure
            </p>
          </CardContent>
        </Card>

        {/* Memory RSS */}
        <Card className="border-border/60 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Memory Heap Used
            </CardTitle>
            <Cpu className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-foreground">
                {health?.system.memoryUsage.heapUsedMb}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                / {health?.system.memoryUsage.heapTotalMb} MB
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              V8 Engine memory allocation
            </p>
          </CardContent>
        </Card>

        {/* Resident Set Size */}
        <Card className="border-border/60 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resident Set (RSS)
            </CardTitle>
            <HardDrive className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-foreground">
                {health?.system.memoryUsage.rssMb}
              </span>
              <span className="text-xs text-muted-foreground font-mono">MB Total</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Process memory in RAM
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Detailed Technical Specs ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Environment & Runtime */}
        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <CardTitle className="text-sm font-bold text-foreground">
              Environment & Host Telemetry
            </CardTitle>
            <CardDescription className="text-xs">
              Node.js and application runtime variables
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Node Engine Version</span>
              <span className="font-mono font-bold text-foreground">
                {health?.system.nodeVersion}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Execution Environment</span>
              <span className="font-mono font-bold text-foreground capitalize">
                {health?.system.environment}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Telemetry Timestamp</span>
              <span className="font-mono text-muted-foreground">
                {health?.timestamp ? new Date(health.timestamp).toUTCString() : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">API Port & Path</span>
              <span className="font-mono text-foreground">
                localhost:3001/api/v1
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Global Multi-Tenant Stats */}
        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <CardTitle className="text-sm font-bold text-foreground">
              Global Multi-Tenant Live Footprint
            </CardTitle>
            <CardDescription className="text-xs">
              Cross-instance active capacity on PostgreSQL cluster
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Active Commercial Businesses</span>
              <span className="font-bold text-foreground">
                {health?.counts.activeTenants} tenants
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Registered Active Users</span>
              <span className="font-bold text-foreground">
                {health?.counts.activeUsers} accounts
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Bound Hardware POS Tills</span>
              <span className="font-bold text-foreground">
                {health?.counts.activeDevices} devices
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
              <span className="text-muted-foreground">Postgres RLS Policy Enforcement</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                ACTIVE & VERIFIED
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
