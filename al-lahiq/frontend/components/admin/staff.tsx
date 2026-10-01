"use client";

import type { Staff, StaffRole } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { useAdminQuery, useInvalidate } from "./data";
import { Modal } from "./modal";
import { ROLE_HINT, ROLE_LABEL } from "./roles";
import { useStaff } from "./staff-context";
import { useToast } from "./toast";
import { DataTable, ErrorState, FormActions, Loading, PageHeader, Panel } from "./ui";

const ROLES: StaffRole[] = ["OWNER", "MANAGER", "ORDER_STAFF", "CONTENT_EDITOR"];

export function StaffView() {
  const me = useStaff();
  const { data, error, isPending, refetch } = useAdminQuery<Staff[]>("/admin/staff");
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Who can log in to this admin, and what they can do."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            Add staff member
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isPending ? (
          <Loading label="Loading staff" />
        ) : (
          <Panel flush className="min-w-0">
            <DataTable minWidth={560}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      <p className="font-medium">
                        {s.name}
                        {s.id === me.id && <span className="font-normal text-steel"> (you)</span>}
                      </p>
                      <p className="break-all text-[13px] text-steel">{s.email}</p>
                    </th>
                    <td>{ROLE_LABEL[s.role]}</td>
                    <td>
                      <Badge tone={s.active ? "pipe" : "neutral"}>{s.active ? "Can log in" : "Deactivated"}</Badge>
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        )}
        <Panel title="What each role can do">
          <dl className="flex flex-col gap-2 text-sm">
            {ROLES.map((r) => (
              <div key={r}>
                <dt className="font-semibold">{ROLE_LABEL[r]}</dt>
                <dd className="text-steel">{ROLE_HINT[r]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing && editing !== "new" ? `Edit ${editing.name}` : "Add staff member"}
        size="sm"
      >
        {editing && (
          <StaffForm
            key={editing === "new" ? "new" : editing.id}
            staff={editing === "new" ? null : editing}
            isMe={editing !== "new" && editing.id === me.id}
            onCancel={() => setEditing(null)}
            onDone={(s, created) => {
              setEditing(null);
              void invalidate("/admin/staff");
              toast(created ? `${s.name} can now log in` : `${s.name}'s account saved`);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function StaffForm({
  staff,
  isMe,
  onDone,
  onCancel,
}: {
  staff: Staff | null;
  isMe: boolean;
  onDone: (s: Staff, created: boolean) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(staff?.email ?? "");
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState<StaffRole>(staff?.role ?? "ORDER_STAFF");
  const [active, setActive] = useState(staff?.active ?? true);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      staff ? adminApi.patch<Staff>(`/admin/staff/${staff.id}`, body) : adminApi.post<Staff>("/admin/staff", body),
    onSuccess: (s) => onDone(s, !staff),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!staff && !/^\S+@\S+\.\S+$/.test(email.trim())) return setProblem("Enter a valid email address. They log in with it.");
    if (name.trim().length < 2) return setProblem("Enter their name.");
    if ((!staff || password) && password.length < 10) return setProblem("The password needs at least 10 characters.");
    if (staff) {
      save.mutate({ name: name.trim(), ...(isMe ? {} : { role, active }), ...(password ? { password } : {}) });
    } else {
      save.mutate({ email: email.trim().toLowerCase(), name: name.trim(), role, password });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      {staff ? (
        <p className="text-sm">
          <span className="text-steel">Email: </span>
          <span className="break-all">{staff.email}</span>
        </p>
      ) : (
        <TextField label="Email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      )}
      <TextField label="Name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <SelectField
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value as StaffRole)}
        disabled={isMe}
        hint={isMe ? "You can't change your own role." : ROLE_HINT[role]}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </SelectField>
      {staff && (
        <Checkbox
          label={isMe ? "Can log in (you can't deactivate yourself)" : "Can log in"}
          checked={active}
          disabled={isMe}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
      <TextField
        label={staff ? "New password (optional)" : "Password"}
        type="password"
        autoComplete="new-password"
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={
          staff
            ? "Leave empty to keep their password. Setting one logs them out everywhere."
            : "At least 10 characters. Share it with them in person, not by email."
        }
      />
      {staff && !active && !isMe && <p className="text-sm text-steel">Deactivating logs them out straight away.</p>}
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {staff ? "Save changes" : "Add staff member"}
        </Button>
      </FormActions>
    </form>
  );
}
