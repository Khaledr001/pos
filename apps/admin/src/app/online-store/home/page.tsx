"use client";

import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, Undo2 } from "lucide-react";
import { DEFAULT_HOME_SECTIONS, MAX_HOME_SECTIONS, SITE_TEMPLATES, type HomeSection } from "@devsfleet/shared-types";
import { usePermission } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loading, Notice, PageHeader } from "../shared";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";
import { SectionEditor, listProblems, useSectionLookups } from "../components/section-editor";

export default function HomeSectionsPage() {
  const mayWrite = usePermission("storefront:write");
  const { overview, settings, loading, saving, error, success, setError, setSuccess, patch } = useStoreSettings();
  const lookups = useSectionLookups();
  const [draft, setDraft] = useState<HomeSection[] | null>(null);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings.homeSections));
  }, [settings]);

  const mode = settings?.site.mode ?? null;
  const dirty = useMemo(() => !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings.homeSections), [draft, settings]);
  const problems = useMemo(() => listProblems(draft ?? [], mode), [draft, mode]);

  if (loading) return <Loading label="Loading the home page..." />;
  if (!overview?.storefront || !draft || !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Home page" description="Choose and order the sections of your home page." />
        <StoreTabs current="/online-store/home" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">Create your online store first, in Store Settings.</Card>
      </div>
    );
  }

  // "Reset" goes back to the template the site started from; a hand-built site has none, so the classic shop front.
  const template = settings.site.template === "custom" ? undefined : SITE_TEMPLATES[settings.site.template];
  const resetTo = template?.homeSections ?? DEFAULT_HOME_SECTIONS;

  return (
    <div className="space-y-6">
      <PageHeader title="Home page" description="Add, reorder and edit the sections of your home page. Products, departments and brands fill in from your catalogue.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={saving} title={template ? `Back to the “${template.label}” template` : "Back to the classic shop front"} onClick={() => setDraft(structuredClone(resetTo))}><RotateCcw className="h-4 w-4" /> Reset to default</Button>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(structuredClone(settings.homeSections))}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0 || draft.length === 0} onClick={() => void patch({ homeSections: draft }, "Home page saved. Visitors see it within a minute.")}><Save className="h-4 w-4" /> Save home page</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/home" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <SectionEditor sections={draft} onChange={setDraft} mayWrite={mayWrite} siteMode={mode} lookups={lookups} max={MAX_HOME_SECTIONS} />
    </div>
  );
}
