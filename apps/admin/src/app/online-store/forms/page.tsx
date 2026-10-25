"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, ClipboardList, Pencil, Plus, Save, Trash2 } from "lucide-react";
import {
  CONTACT_FORM_SLUG,
  DEFAULT_ENQUIRY_FORM_SLUG,
  FORM_FIELD_KEY,
  FORM_FIELD_TYPES,
  FORM_SLUG,
  MAX_FORM_FIELDS,
  type FormDef,
  type FormField,
  type FormFieldRole,
  type FormFieldType,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { Table, TableBody, TableContainer, TableEmpty, TableHead, Th } from "@/components/ui/data-table";
import { Field, Loading, Notice, PageHeader, errorText, textareaClass } from "../shared";
import { StoreTabs } from "../store-nav";

const MAX_NOTIFY = 5;
const MAX_OPTIONS = 30;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  email: "Email address",
  phone: "Phone number",
  textarea: "Long text",
  select: "Drop-down list",
  checkbox: "Tick box",
  number: "Number",
  date: "Date",
};
/** A role fills the lead's name/email/phone, so it only makes sense on a field that can hold one. */
const ROLE_FOR_TYPE: Partial<Record<FormFieldType, FormFieldRole>> = { text: "name", email: "email", phone: "phone" };
const ROLE_LABELS: Record<FormFieldRole, string> = { name: "The person's name", email: "The person's email", phone: "The person's phone" };

/** A field as edited: the stored shape plus what the editor needs to behave. */
interface EditorField extends Omit<FormField, "options"> {
  uid: string;
  /** Came from the server, so its key is fixed: leads already hold answers under it. */
  saved: boolean;
  /** The key was typed by hand, so renaming the label no longer rewrites it. */
  keyEdited: boolean;
  optionsText: string;
}

interface EditorForm {
  isNew: boolean;
  slug: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  notifyText: string;
  acknowledge: boolean;
  isActive: boolean;
  fields: EditorField[];
}

let uidCounter = 0;
const uid = () => `f${++uidCounter}`;

const keyFromLabel = (label: string, taken: Set<string>): string => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]+/, "").slice(0, 36) || "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 36)}_${n}`;
  return key;
};

const slugFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function toEditor(f: FormDef): EditorForm {
  return {
    isNew: false,
    slug: f.slug,
    name: f.name,
    submitLabel: f.submitLabel,
    successMessage: f.successMessage,
    notifyText: f.notifyEmails.join("\n"),
    acknowledge: f.acknowledge,
    isActive: f.isActive,
    fields: f.fields.map((x) => ({ ...x, options: undefined, uid: uid(), saved: true, keyEdited: true, optionsText: (x.options ?? []).join("\n") })),
  };
}

const blankForm = (): EditorForm => ({
  isNew: true,
  slug: "",
  name: "",
  submitLabel: "Send",
  successMessage: "Thanks! We'll get back to you shortly.",
  notifyText: "",
  acknowledge: true,
  isActive: true,
  fields: [
    { uid: uid(), saved: false, keyEdited: false, key: "name", type: "text", label: "Your name", required: true, role: "name", optionsText: "" },
    { uid: uid(), saved: false, keyEdited: false, key: "email", type: "email", label: "Email", required: true, role: "email", optionsText: "" },
    { uid: uid(), saved: false, keyEdited: false, key: "message", type: "textarea", label: "Message", required: true, optionsText: "" },
  ],
});

const parseList = (text: string) => text.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);

function toDef(f: EditorForm): FormDef {
  return {
    slug: f.slug,
    name: f.name.trim(),
    submitLabel: f.submitLabel.trim(),
    successMessage: f.successMessage.trim(),
    notifyEmails: parseList(f.notifyText),
    acknowledge: f.acknowledge,
    isActive: f.isActive,
    fields: f.fields.map((x) => {
      const out: FormField = { key: x.key, type: x.type, label: x.label.trim(), required: x.required };
      if (x.placeholder?.trim()) out.placeholder = x.placeholder.trim();
      if (x.helpText?.trim()) out.helpText = x.helpText.trim();
      if (x.role) out.role = x.role;
      if (x.type === "select") out.options = [...new Set(parseList(x.optionsText.replace(/,/g, "\n")))].slice(0, MAX_OPTIONS);
      return out;
    }),
  };
}

function problemsOf(f: EditorForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("Give the form a name.");
  if (f.isNew && !FORM_SLUG.test(f.slug)) out.push("The address uses lowercase letters, digits and hyphens, e.g. get-a-quote.");
  if (!f.submitLabel.trim()) out.push("The submit button needs a label.");
  if (!f.successMessage.trim()) out.push("Write the message shown after a form is sent.");
  if (f.fields.length === 0) out.push("Add at least one field.");
  const emails = parseList(f.notifyText);
  if (emails.length > MAX_NOTIFY) out.push(`At most ${MAX_NOTIFY} notification addresses.`);
  if (emails.some((e) => !EMAIL.test(e))) out.push("One of the notification addresses is not a valid email.");
  const keys = new Set<string>();
  const roles = new Set<string>();
  for (const [i, x] of f.fields.entries()) {
    const n = `Field ${i + 1}`;
    if (!x.label.trim()) out.push(`${n} needs a label.`);
    if (!FORM_FIELD_KEY.test(x.key)) out.push(`${n}: the key uses lowercase letters, digits and underscores, starting with a letter.`);
    if (keys.has(x.key)) out.push(`${n}: the key “${x.key}” is used twice.`);
    keys.add(x.key);
    if (x.role) {
      if (roles.has(x.role)) out.push(`Only one field can be ${ROLE_LABELS[x.role].toLowerCase()}.`);
      roles.add(x.role);
    }
    if (x.type === "select" && parseList(x.optionsText).length === 0) out.push(`${n}: add at least one option for the drop-down.`);
  }
  return out;
}

export default function FormsPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);

  const [forms, setForms] = useState<FormDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setForms((await api.get<FormDef[]>("/storefront-admin/forms", auth)) ?? []);
    } catch (err) {
      setError(errorText(err, "Failed to load forms."));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  const problems = useMemo(() => (editing ? problemsOf(editing) : []), [editing]);

  async function save() {
    if (!editing || problems.length > 0) return;
    setSaving(true);
    setError(null);
    const def = toDef(editing);
    try {
      if (editing.isNew) await api.post("/storefront-admin/forms", def, auth);
      else await api.patch(`/storefront-admin/forms/${editing.slug}`, def, auth);
      setSuccess(`“${def.name}” saved.`);
      setEditing(null);
      void load();
    } catch (err) {
      setError(errorText(err, "That form was refused."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(f: FormDef) {
    const extra = f.slug === DEFAULT_ENQUIRY_FORM_SLUG ? "\n\nThis is the form behind the product “Enquire” button." : "";
    if (!window.confirm(`Delete “${f.name}”?\n\nLeads it already collected keep their answers. Pages that show this form will lose it.${extra}`)) return;
    try {
      await api.delete(`/storefront-admin/forms/${f.slug}`, auth);
      setSuccess(`“${f.name}” deleted.`);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not delete that form."));
    }
  }

  if (editing) {
    return (
      <FormEditor
        form={editing}
        setForm={setEditing}
        problems={problems}
        saving={saving}
        mayWrite={mayWrite}
        error={error}
        clearError={() => setError(null)}
        onSave={() => void save()}
        onBack={() => {
          setEditing(null);
          setError(null);
        }}
      />
    );
  }

  const badgeFor = (f: FormDef) =>
    f.slug === DEFAULT_ENQUIRY_FORM_SLUG ? <Badge variant="outline">Product enquiries</Badge> : f.slug === CONTACT_FORM_SLUG ? <Badge variant="outline">Contact page</Badge> : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Forms" description="Contact, quote and enquiry forms for your website. Every submission arrives in Leads.">
        {mayWrite && <Button size="sm" onClick={() => setEditing(blankForm())}><Plus className="h-4 w-4" /> New form</Button>}
      </PageHeader>
      <StoreTabs current="/online-store/forms" />
      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {loading && forms.length === 0 ? (
        <Loading label="Loading forms..." />
      ) : (
        <>
          <MobileList loading={false} empty={<MobileEmpty icon={ClipboardList} title="No forms yet" />}>
            {forms.map((f) => (
              <MobileRow
                key={f.slug}
                title={f.name}
                subtitle={f.slug}
                badge={<Badge variant={f.isActive ? "success" : "secondary"}>{f.isActive ? "Active" : "Off"}</Badge>}
                fields={[{ label: "Fields", value: f.fields.length, numeric: true }, { label: "Alerts to", value: f.notifyEmails.length ? `${f.notifyEmails.length} address${f.notifyEmails.length === 1 ? "" : "es"}` : "—" }]}
                actions={mayWrite ? (<><Button variant="outline" size="sm" onClick={() => setEditing(toEditor(f))}><Pencil className="h-3.5 w-3.5" /> Edit</Button><Button variant="outline" size="sm" className="text-destructive" onClick={() => void remove(f)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button></>) : undefined}
              />
            ))}
          </MobileList>
          <Card className="hidden overflow-hidden md:block">
            <TableContainer>
              <Table>
                <TableHead>
                  <tr><Th>Form</Th><Th>Address</Th><Th align="right">Fields</Th><Th>Alerts to</Th><Th>Status</Th><Th align="right"><span className="sr-only">Actions</span></Th></tr>
                </TableHead>
                <TableBody columns={6} loading={false} empty={<TableEmpty columns={6} icon={ClipboardList} title="No forms yet" />}>
                  {forms.map((f) => (
                    <tr key={f.slug} className="hover:bg-secondary/30">
                      <td className="px-4 py-3.5 font-medium text-foreground">{f.name} {badgeFor(f)}</td>
                      <td className="px-4 py-3.5 font-mono text-muted-foreground">{f.slug}</td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">{f.fields.length}</td>
                      <td className="px-4 py-3.5 text-muted-foreground">{f.notifyEmails.length ? f.notifyEmails.join(", ") : "—"}</td>
                      <td className="px-4 py-3.5"><Badge variant={f.isActive ? "success" : "secondary"}>{f.isActive ? "Active" : "Off"}</Badge></td>
                      <td className="space-x-3 px-4 py-3.5 text-right">
                        {mayWrite && <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Edit ${f.name}`} onClick={() => setEditing(toEditor(f))}><Pencil className="h-3.5 w-3.5" /></button>}
                        {mayWrite && <button type="button" className="cursor-pointer text-muted-foreground hover:text-destructive" aria-label={`Delete ${f.name}`} onClick={() => void remove(f)}><Trash2 className="h-3.5 w-3.5" /></button>}
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </>
      )}
    </div>
  );
}

function FormEditor({
  form,
  setForm,
  problems,
  saving,
  mayWrite,
  error,
  clearError,
  onSave,
  onBack,
}: {
  form: EditorForm;
  setForm: (f: EditorForm) => void;
  problems: string[];
  saving: boolean;
  mayWrite: boolean;
  error: string | null;
  clearError: () => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const [slugEdited, setSlugEdited] = useState(false);
  const setField = (id: string, patch: Partial<EditorField>) => setForm({ ...form, fields: form.fields.map((x) => (x.uid === id ? { ...x, ...patch } : x)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...form.fields];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f!);
    setForm({ ...form, fields: next });
  };
  const addField = () => {
    const taken = new Set(form.fields.map((x) => x.key));
    setForm({ ...form, fields: [...form.fields, { uid: uid(), saved: false, keyEdited: false, key: keyFromLabel("", taken), type: "text", label: "", required: false, optionsText: "" }] });
  };
  const rename = (x: EditorField, label: string) => {
    const taken = new Set(form.fields.filter((o) => o.uid !== x.uid).map((o) => o.key));
    setField(x.uid, { label, ...(x.saved || x.keyEdited ? {} : { key: keyFromLabel(label, taken) }) });
  };
  const roleOptions = (x: EditorField) => {
    const role = ROLE_FOR_TYPE[x.type];
    const takenByOther = new Set(form.fields.filter((o) => o.uid !== x.uid && o.role).map((o) => o.role));
    return [{ value: "", label: "None" }, ...(role && !takenByOther.has(role) ? [{ value: role, label: ROLE_LABELS[role] }] : [])];
  };
  const hasEmailField = form.fields.some((x) => x.type === "email");

  return (
    <div className="space-y-6">
      <PageHeader title={form.isNew ? "New form" : `Edit “${form.name}”`} description="Fields appear in this order. The preview shows the form as visitors will see it.">
        <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to forms</Button>
        {mayWrite && <Button size="sm" disabled={saving || problems.length > 0} onClick={onSave}><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save form"}</Button>}
      </PageHeader>
      {error && <Notice kind="error" message={error} onClose={clearError} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <fieldset disabled={!mayWrite} className="min-w-0 space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Form</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, ...(form.isNew && !slugEdited ? { slug: slugFromName(e.target.value) } : {}) })} /></Field>
              <Field label="Address" hint={form.isNew ? "Lowercase letters, digits and hyphens. Fixed once created." : "Fixed once created, because pages refer to it."}>
                <Input className="font-mono" maxLength={60} disabled={!form.isNew} value={form.slug} onChange={(e) => { setSlugEdited(true); setForm({ ...form, slug: e.target.value.toLowerCase() }); }} />
              </Field>
              <Field label="Submit button"><Input maxLength={40} value={form.submitLabel} onChange={(e) => setForm({ ...form, submitLabel: e.target.value })} /></Field>
              <Field label="Message after sending"><Input maxLength={300} value={form.successMessage} onChange={(e) => setForm({ ...form, successMessage: e.target.value })} /></Field>
            </div>
            <Field label="Tell these people about every submission" hint={`One email per line, up to ${MAX_NOTIFY}. They are never shown to visitors.`}>
              <textarea rows={2} className={textareaClass} value={form.notifyText} onChange={(e) => setForm({ ...form, notifyText: e.target.value })} placeholder="sales@yourcompany.com" />
            </Field>
            <div className="flex flex-wrap gap-5 text-xs font-medium">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={form.acknowledge} onChange={(e) => setForm({ ...form, acknowledge: e.target.checked })} /> Email the sender a copy</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Accepting submissions</label>
            </div>
            {form.acknowledge && !hasEmailField && <p className="text-[11px] text-amber-600 dark:text-amber-400">There is no email field, so nobody can be sent a copy.</p>}
            {!form.isNew && form.slug === DEFAULT_ENQUIRY_FORM_SLUG && <p className="text-[11px] text-muted-foreground">This form powers the “Enquire” button on product pages in a catalogue site.</p>}
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Fields</h2>
              <span className="text-[11px] text-muted-foreground">{form.fields.length} of {MAX_FORM_FIELDS}</span>
            </div>
            <ol className="space-y-3">
              {form.fields.map((x, i) => (
                <li key={x.uid} className="flex gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Label"><Input maxLength={80} value={x.label} onChange={(e) => rename(x, e.target.value)} /></Field>
                      <Field label="Type">
                        <SelectField size="sm" label={`Field ${i + 1} type`} value={x.type} onValueChange={(v) => { const type = v as FormFieldType; setField(x.uid, { type, role: x.role && ROLE_FOR_TYPE[type] === x.role ? x.role : undefined }); }} options={FORM_FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
                      </Field>
                      <Field label="Fills in the lead's…" hint="So the inbox can show and search it.">
                        <SelectField size="sm" label={`Field ${i + 1} role`} value={x.role ?? ""} onValueChange={(v) => setField(x.uid, { role: (v || undefined) as FormFieldRole | undefined })} options={roleOptions(x)} />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Key" hint={x.saved ? "Fixed: leads already hold answers under it." : "How the answer is stored. Made from the label; edit if you like."}>
                        <Input className="font-mono" maxLength={40} disabled={x.saved} aria-invalid={!FORM_FIELD_KEY.test(x.key)} value={x.key} onChange={(e) => setField(x.uid, { key: e.target.value.toLowerCase(), keyEdited: true })} />
                      </Field>
                      {x.type !== "checkbox" && x.type !== "select" && x.type !== "date" && <Field label="Placeholder"><Input maxLength={120} value={x.placeholder ?? ""} onChange={(e) => setField(x.uid, { placeholder: e.target.value })} /></Field>}
                      <Field label="Help text"><Input maxLength={200} value={x.helpText ?? ""} onChange={(e) => setField(x.uid, { helpText: e.target.value })} /></Field>
                    </div>
                    {x.type === "select" && (
                      <Field label="Options" hint={`One per line, up to ${MAX_OPTIONS}.`}>
                        <textarea rows={3} className={textareaClass} value={x.optionsText} onChange={(e) => setField(x.uid, { optionsText: e.target.value })} />
                      </Field>
                    )}
                    <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={x.required} onChange={(e) => setField(x.uid, { required: e.target.checked })} /> Required</label>
                  </div>
                  {mayWrite && (
                    <div className="flex shrink-0 flex-col items-center gap-0.5">
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move field ${i + 1} down`} disabled={i === form.fields.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Remove field ${i + 1}`} onClick={() => setForm({ ...form, fields: form.fields.filter((o) => o.uid !== x.uid) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {mayWrite && <Button type="button" size="sm" variant="outline" disabled={form.fields.length >= MAX_FORM_FIELDS} onClick={addField}><Plus className="h-4 w-4" /> Add field</Button>}
          </Card>
        </fieldset>

        <aside aria-label="Form preview" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Preview</h2>
            <FormPreview form={form} />
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** What a visitor sees, drawn from the draft. Inputs are inert: it is a picture of a form, not a form. */
function FormPreview({ form }: { form: EditorForm }) {
  const input = "h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-muted-foreground";
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4" role="img" aria-label="Preview of the form">
      <div className="text-sm font-semibold">{form.name || "Form name"}</div>
      {form.fields.map((x) => (
        <div key={x.uid} className="space-y-1">
          {x.type === "checkbox" ? (
            <div className="flex items-center gap-2 text-xs"><span className="h-4 w-4 rounded border border-input" aria-hidden="true" />{x.label || "Label"}{x.required && <span className="text-destructive"> *</span>}</div>
          ) : (
            <>
              <div className="text-xs font-medium">{x.label || "Label"}{x.required && <span className="text-destructive"> *</span>}</div>
              {x.type === "textarea" ? (
                <div className={`${input} h-16 py-2`}>{x.placeholder}</div>
              ) : x.type === "select" ? (
                <div className={`${input} flex items-center justify-between py-2`}><span>{parseList(x.optionsText)[0] ?? "Choose…"}</span><ChevronDown className="h-3.5 w-3.5" /></div>
              ) : (
                <div className={`${input} py-2`}>{x.placeholder || (x.type === "date" ? "dd/mm/yyyy" : "")}</div>
              )}
            </>
          )}
          {x.helpText && <div className="text-[11px] text-muted-foreground">{x.helpText}</div>}
        </div>
      ))}
      <div className="inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">{form.submitLabel || "Send"}</div>
    </div>
  );
}
