"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, Monitor, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Where the till installers actually live: a plain static directory nginx
 * serves directly, same-origin with this page (see the `location /pos-dl/`
 * block in deploy/nginx/devsfleet-pos.conf). electron-updater on every till
 * reads the same latest*.yml files this page parses, so what's offered here
 * is always exactly what the tills would auto-update to next.
 */
const FEED_BASE = "/pos-dl";

interface PlatformRelease {
  platform: "Windows" | "Linux";
  icon: typeof Monitor;
  manifest: string;
  version: string;
  fileName: string;
}

interface FetchState {
  loading: boolean;
  releases: PlatformRelease[];
  /** Per-platform manifests that 404'd or failed to parse, not a hard error. */
  unavailable: string[];
  error: string | null;
}

/**
 * electron-builder's own generated format, not user input — top-level keys
 * only, so an anchored per-line match is enough without a YAML dependency.
 */
function extractYamlField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? null;
}

export default function ReleasesPage() {
  const [state, setState] = useState<FetchState>({
    loading: true,
    releases: [],
    unavailable: [],
    error: null,
  });

  useEffect(() => {
    const platforms: Array<{ platform: PlatformRelease["platform"]; icon: PlatformRelease["icon"]; manifest: string }> = [
      { platform: "Windows", icon: Monitor, manifest: "latest.yml" },
      { platform: "Linux", icon: TerminalIcon, manifest: "latest-linux.yml" },
    ];

    let cancelled = false;

    Promise.allSettled(
      platforms.map(async (p) => {
        const res = await fetch(`${FEED_BASE}/${p.manifest}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${p.platform}: no release published yet`);
        const text = await res.text();
        const version = extractYamlField(text, "version");
        const fileName = extractYamlField(text, "path");
        if (!version || !fileName) throw new Error(`${p.platform}: manifest is missing version or path`);
        return { platform: p.platform, icon: p.icon, manifest: p.manifest, version, fileName } satisfies PlatformRelease;
      }),
    ).then((results) => {
      if (cancelled) return;
      const releases: PlatformRelease[] = [];
      const unavailable: string[] = [];
      for (const [i, result] of results.entries()) {
        if (result.status === "fulfilled") releases.push(result.value);
        else unavailable.push(platforms[i]!.platform);
      }
      setState({ loading: false, releases, unavailable, error: null });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">POS Terminal Downloads</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
          Install the till app on a new terminal, or reinstall it on an existing one. Already-installed
          terminals check for updates against this same feed on their own — you only need this page for a
          brand-new machine.
        </p>
      </div>

      {state.loading ? (
        <Card className="p-16 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin mb-3" />
          Checking for published releases...
        </Card>
      ) : state.releases.length === 0 ? (
        <Card className="p-10 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <h3 className="mt-4 text-sm font-semibold text-foreground">No release has been published yet</h3>
          <p className="mt-1.5 text-xs text-muted-foreground max-w-md mx-auto">
            Cut one with <code className="font-mono">git tag pos-v1.0.0 && git push origin pos-v1.0.0</code> —
            the release workflow publishes the installers this page reads from.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          {state.releases.map((r) => (
            <Card key={r.platform} className="p-5 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                  <r.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{r.platform}</p>
                  <Badge variant="secondary" className="mt-0.5 font-mono text-[10px]">
                    v{r.version}
                  </Badge>
                </div>
              </div>
              <Button asChild className="w-full justify-center">
                <a href={`${FEED_BASE}/${r.fileName}`}>
                  <Download className="h-4 w-4" />
                  Download for {r.platform}
                </a>
              </Button>
            </Card>
          ))}
        </div>
      )}

      {!state.loading && state.unavailable.length > 0 && state.releases.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No {state.unavailable.join(" / ")} build in the latest release.
        </p>
      )}

      <Card className="p-5 max-w-2xl">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground mb-1">After installing</p>
            <p>
              First launch shows a pairing screen. Sign in with an admin account, pick the branch this till
              belongs to, and it&rsquo;s ready to sell. No manual configuration file is needed.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
