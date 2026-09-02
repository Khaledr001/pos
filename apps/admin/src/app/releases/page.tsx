"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Laptop, Loader2, Monitor, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Where the till installers actually live: served by this app itself, at
 * apps/admin/src/app/pos-dl/[...path]/route.ts — not a separate nginx
 * location, deliberately (see that file's header comment for why). Same
 * origin as this page, and electron-updater on every till reads the same
 * latest*.yml files this page parses, so what's offered here is always
 * exactly what the tills would auto-update to next.
 */
const FEED_BASE = "/pos-dl";

interface PlatformRelease {
  platform: "Windows" | "macOS" | "Linux";
  icon: typeof Monitor;
  manifest: string;
  version: string;
  fileName: string;
  /** A second install format for the same platform, if one exists — e.g.
   *  Linux's .deb alongside its primary, auto-updatable .AppImage. */
  secondary?: { label: string; fileName: string };
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
      { platform: "macOS", icon: Laptop, manifest: "latest-mac.yml" },
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

        const release: PlatformRelease = { platform: p.platform, icon: p.icon, manifest: p.manifest, version, fileName };

        // Linux ships two install formats, but only the AppImage is what
        // electron-updater actually knows how to auto-update, so it's the
        // only one latest-linux.yml's `path` ever names. The .deb still gets
        // published alongside it (see deploy/release-pos.sh / pos-release.yml)
        // under electron-builder's standard Debian-arch naming — checked with
        // HEAD rather than assumed, so a missing .deb just quietly omits the
        // button instead of offering a dead link.
        if (p.platform === "Linux") {
          const debName = `devsfleet-pos-${version}-amd64.deb`;
          const debCheck = await fetch(`${FEED_BASE}/${debName}`, { method: "HEAD", cache: "no-store" });
          if (debCheck.ok) release.secondary = { label: ".deb package", fileName: debName };
        }

        return release;
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
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
              <div className="flex flex-col gap-2">
                <Button asChild className="w-full justify-center">
                  <a href={`${FEED_BASE}/${r.fileName}`}>
                    <Download className="h-4 w-4" />
                    Download for {r.platform}
                  </a>
                </Button>
                {r.secondary && (
                  <Button asChild variant="outline" size="sm" className="w-full justify-center">
                    <a href={`${FEED_BASE}/${r.secondary.fileName}`}>
                      <Download className="h-3.5 w-3.5" />
                      {r.secondary.label}
                    </a>
                  </Button>
                )}
              </div>
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
