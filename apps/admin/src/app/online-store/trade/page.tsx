"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { Notice, PageHeader, StatusBadge, errorText, selectClass } from "../shared";

interface Application {
  accountId: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  companyName: string | null;
  trn: string | null;
  tradeStatus: string;
  tradeNote: string | null;
  updatedAt: string;
  customerType: string;
  priceListId: string | null;
}

interface PriceList { id: string; name: string; type: string; isDefault: boolean }

export default function TradeApplicationsPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("customer:write");
  const auth = { accessToken: tokens?.accessToken };

  const [apps, setApps] = useState<Application[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [choice, setChoice] = useState<Record<string, { priceListId: string; customerType: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ applications: Application[]; priceLists: PriceList[] }>("/storefront-admin/trade-applications", auth);
      setApps(res.applications);
      setLists(res.priceLists);
    } catch (err) {
      setError(errorText(err, "Failed to load applications."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  const tradeList = lists.find((l) => l.type === "wholesale") ?? lists.find((l) => !l.isDefault) ?? lists[0];

  async function decide(a: Application, approve: boolean) {
    setError(null);
    try {
      if (approve) {
        const picked = choice[a.accountId] ?? { priceListId: tradeList?.id ?? "", customerType: "wholesale" };
        if (!picked.priceListId) throw new Error("Pick a price list first.");
        await api.post(`/storefront-admin/trade-applications/${a.accountId}/approve`, picked, auth);
        setSuccess(`${a.companyName ?? a.email} now buys at trade prices.`);
      } else {
        const note = window.prompt("Reason (optional, kept on the account):") ?? undefined;
        await api.post(`/storefront-admin/trade-applications/${a.accountId}/reject`, note ? { note } : {}, auth);
      }
      void load();
    } catch (err) {
      setError(errorText(err, "That decision was refused."));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Trade Applications" description="Contractors asking for trade prices online. Approving puts the customer on a price list — the same one the counter uses." />
      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <MobileList
        loading={loading && apps.length === 0}
        empty={<MobileEmpty icon={Briefcase} title="No trade applications" />}
      >
        {apps.map((a) => {
          const picked = choice[a.accountId] ?? { priceListId: tradeList?.id ?? "", customerType: "wholesale" };
          const who = `${a.firstName} ${a.lastName}`;
          const deciding = mayWrite && a.tradeStatus === "PENDING";
          return (
            <MobileRow
              key={a.accountId}
              title={who}
              subtitle={a.companyName ?? undefined}
              badge={<StatusBadge status={a.tradeStatus} />}
              fields={[
                { label: "Email", value: a.email },
                { label: "Phone", value: a.phone || "—" },
                { label: "Company", value: a.companyName ?? "—" },
                { label: "TRN", value: a.trn ? <span className="font-mono">{a.trn}</span> : "—" },
                ...(a.tradeNote ? [{ label: "Note", value: <span className="italic">“{a.tradeNote}”</span> }] : []),
                ...(deciding
                  ? [
                      {
                        label: "Price list",
                        value: (
                          <select aria-label={`Price list for ${who}`} className={`${selectClass} w-40`} value={picked.priceListId} onChange={(e) => setChoice({ ...choice, [a.accountId]: { ...picked, priceListId: e.target.value } })}>
                            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        ),
                      },
                      {
                        label: "Customer type",
                        value: (
                          <select aria-label={`Customer type for ${who}`} className={`${selectClass} w-40`} value={picked.customerType} onChange={(e) => setChoice({ ...choice, [a.accountId]: { ...picked, customerType: e.target.value } })}>
                            <option value="wholesale">Wholesale</option>
                            <option value="vip">VIP</option>
                          </select>
                        ),
                      },
                    ]
                  : []),
              ]}
              actions={
                deciding ? (
                  <>
                    <Button size="sm" onClick={() => void decide(a, true)}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => void decide(a, false)}>Reject</Button>
                  </>
                ) : undefined
              }
            />
          );
        })}
      </MobileList>

      <Card className="hidden overflow-hidden md:block">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <Th>Applicant</Th>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>Decision</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={4}
              loading={loading && apps.length === 0}
              empty={<TableEmpty columns={4} icon={Briefcase} title="No trade applications" />}
            >
              {apps.map((a) => {
                const picked = choice[a.accountId] ?? { priceListId: tradeList?.id ?? "", customerType: "wholesale" };
                const who = `${a.firstName} ${a.lastName}`;
                return (
                  <tr key={a.accountId} className="align-top">
                    <td className="px-4 py-3.5"><div className="font-medium text-foreground">{who}</div><div className="text-muted-foreground">{a.email}{a.phone ? ` · ${a.phone}` : ""}</div></td>
                    <td className="px-4 py-3.5"><div>{a.companyName ?? "—"}</div><div className="font-mono text-muted-foreground">{a.trn ? `TRN ${a.trn}` : ""}</div>{a.tradeNote && <div className="mt-1 italic text-muted-foreground">“{a.tradeNote}”</div>}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={a.tradeStatus} /></td>
                    <td className="px-4 py-3.5">
                      {mayWrite && a.tradeStatus === "PENDING" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select aria-label={`Price list for ${who}`} className={`${selectClass} w-44`} value={picked.priceListId} onChange={(e) => setChoice({ ...choice, [a.accountId]: { ...picked, priceListId: e.target.value } })}>
                            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                          <select aria-label={`Customer type for ${who}`} className={`${selectClass} w-32`} value={picked.customerType} onChange={(e) => setChoice({ ...choice, [a.accountId]: { ...picked, customerType: e.target.value } })}>
                            <option value="wholesale">Wholesale</option>
                            <option value="vip">VIP</option>
                          </select>
                          <Button size="sm" onClick={() => void decide(a, true)}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => void decide(a, false)}>Reject</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </div>
  );
}
