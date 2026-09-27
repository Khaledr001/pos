"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  Banknote,
  Receipt,
  Printer,
  Download,
  AlertCircle,
  CheckCircle2,
  X,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Sparkles,
  FileText,
  FileCheck,
  TrendingUp,
  MessageCircle,
  Eye,
  Sliders,
  Award,
  Wallet,
  Coins,
  ChevronRight,
  Info,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { usePermission } from "@/lib/require-auth";
import { api, apiDownload, printBlob, saveBlob } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { timeAgo } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  trn?: string | null;
  address?: string | null;
  type: "retail" | "wholesale" | "vip";
  locale: "en" | "ar";
  creditLimit: string;
  creditBalance: string;
  paymentTermDays: number;
  creditOnHold: boolean;
  loyaltyPoints: number;
  whatsappPhone?: string | null;
  notes?: string | null;
  isActive: boolean;
  branchId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SaleItem {
  id: string;
  productName: string;
  variantName?: string | null;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string | null;
  taxPercent: string;
  taxAmount?: string;
  total: string;
}

interface SalePayment {
  method: string;
  amount: string;
  reference?: string | null;
}

interface CustomerSale {
  id: string;
  saleNumber?: string;
  invoiceNumber?: string;
  occurredAt?: string;
  createdAt?: string;
  total: string;
  paidAmount?: string;
  dueAmount?: string;
  status: string;
  subtotal?: string;
  taxAmount?: string;
  discountAmount?: string;
  notes?: string | null;
  branchName?: string;
  customerName?: string;
  cashierName?: string;
  voidedAt?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
}

interface CustomerPaymentRecord {
  id: string;
  branchId: string;
  customerId: string;
  amount: string;
  method: string;
  referenceNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

interface CustomerQuotation {
  id: string;
  quotationNumber: string;
  total: string;
  status: "draft" | "sent" | "accepted" | "converted" | "expired";
  createdAt: string;
  expiresAt?: string | null;
  branchName?: string;
  itemsCount?: number;
}

interface LoyaltyRecord {
  id: string;
  points: number;
  type: "earned" | "redeemed";
  referenceType?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

const TYPE_GRADIENT: Record<string, string> = {
  wholesale: "from-blue-600 to-indigo-700",
  retail: "from-emerald-600 to-teal-700",
  vip: "from-amber-500 to-orange-600",
};

const PAYMENT_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-3.5 w-3.5 text-emerald-500" />,
  card: <CreditCard className="h-3.5 w-3.5 text-primary" />,
  bank_transfer: <Receipt className="h-3.5 w-3.5 text-blue-500" />,
  cheque: <FileText className="h-3.5 w-3.5 text-violet-500" />,
  credit: <CreditCard className="h-3.5 w-3.5 text-amber-500" />,
};

function formatMoney(amount?: string | number | null): string {
  if (amount === undefined || amount === null || amount === "") return "0.00";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return isNaN(num)
    ? "0.00"
    : num.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-AE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { tokens, user } = useAuth();
  const customerId = (params?.id as string) || "";

  // Permissions
  const canWriteCustomer = usePermission("customer:write");
  const canCreditCustomer = usePermission("customer:credit");
  const canRecordPayment = usePermission("payment:write");

  // State
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<CustomerSale[]>([]);
  const [payments, setPayments] = useState<CustomerPaymentRecord[]>([]);
  const [quotations, setQuotations] = useState<CustomerQuotation[]>([]);
  const [loyaltyHistory, setLoyaltyHistory] = useState<LoyaltyRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedTRN, setCopiedTRN] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Tabs
  type TabKey = "invoices" | "payments" | "statement" | "quotations" | "loyalty";
  const [activeTab, setActiveTab] = useState<TabKey>("invoices");

  // Invoices filters
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("all");

  // Bill Details Modal
  const [selectedSale, setSelectedSale] = useState<CustomerSale | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [printingSaleId, setPrintingSaleId] = useState<string | null>(null);
  const [downloadingSaleId, setDownloadingSaleId] = useState<string | null>(null);

  // Modals
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);

  // Form states
  // 1. Payment Form
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("cash");
  const [payBranchId, setPayBranchId] = useState<string>("");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);

  // 2. Edit Form
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTrn, setEditTrn] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editType, setEditType] = useState<"retail" | "wholesale" | "vip">("retail");
  const [editLocale, setEditLocale] = useState<"en" | "ar">("en");
  const [editTerms, setEditTerms] = useState("0");
  const [editNotes, setEditNotes] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // 3. Credit Form
  const [creditLimitInput, setCreditLimitInput] = useState("0");
  const [creditOnHoldInput, setCreditOnHoldInput] = useState(false);
  const [creditSubmitting, setCreditSubmitting] = useState(false);

  // 4. Loyalty Form
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState("50");
  const [loyaltyTypeInput, setLoyaltyTypeInput] = useState<"add" | "redeem">("add");
  const [loyaltyReasonInput, setLoyaltyReasonInput] = useState("");
  const [loyaltySubmitting, setLoyaltySubmitting] = useState(false);

  // ── Data Fetching ─────────────────────────────────────────────────────────

  const loadCustomerData = useCallback(
    async (isSilent = false) => {
      if (!customerId || !tokens?.accessToken) return;
      if (!isSilent) setLoading(true);
      else setRefreshing(true);
      setPageError(null);

      try {
        // Fetch customer profile
        const custData = await api.get<Customer>(`/customers/${customerId}`, {
          accessToken: tokens.accessToken,
        });
        setCustomer(custData);

        // Fetch sales/invoices for customer
        const salesRes = await api.get<any>(`/sales`, {
          accessToken: tokens.accessToken,
          query: { customerId, limit: 100 },
        });
        const salesList: CustomerSale[] = Array.isArray(salesRes)
          ? salesRes
          : salesRes?.items ?? [];
        setSales(salesList);

        // Fetch payments history
        try {
          const payRes = await api.get<CustomerPaymentRecord[]>(
            `/customers/${customerId}/payments`,
            { accessToken: tokens.accessToken },
          );
          setPayments(Array.isArray(payRes) ? payRes : []);
        } catch {
          setPayments([]);
        }

        // Fetch quotations
        try {
          const quotesRes = await api.get<any>(`/quotations`, {
            accessToken: tokens.accessToken,
            query: { customerId, pageSize: 100 },
          });
          const quotesList = Array.isArray(quotesRes) ? quotesRes : quotesRes?.items ?? [];
          setQuotations(quotesList);
        } catch {
          setQuotations([]);
        }

        // Fetch loyalty history
        try {
          const loyRes = await api.get<LoyaltyRecord[]>(`/customers/${customerId}/loyalty`, {
            accessToken: tokens.accessToken,
          });
          setLoyaltyHistory(Array.isArray(loyRes) ? loyRes : []);
        } catch {
          setLoyaltyHistory([]);
        }

        // Fetch branches
        try {
          const branchesRes = await api.get<any>(`/branches`, {
            accessToken: tokens.accessToken,
          });
          const brList = Array.isArray(branchesRes) ? branchesRes : branchesRes?.items ?? [];
          setBranches(brList);
          if (brList.length > 0 && !payBranchId) {
            setPayBranchId(custData.branchId || brList[0].id);
          }
        } catch {
          // ignore
        }
      } catch (err: any) {
        console.error("Failed to load customer profile:", err);
        setPageError(err?.message || "Failed to load customer data.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [customerId, tokens?.accessToken, payBranchId],
  );

  useEffect(() => {
    loadCustomerData();
  }, [loadCustomerData]);

  // ── Open Bill Detail ──────────────────────────────────────────────────────

  const openBill = async (sale: CustomerSale) => {
    setSelectedSale(sale);
    setBillLoading(true);
    try {
      const full = await api.get<CustomerSale>(`/sales/${sale.id}`, {
        accessToken: tokens?.accessToken,
      });
      setSelectedSale(full);
    } catch (err: any) {
      console.error("Failed to load bill detail:", err);
    } finally {
      setBillLoading(false);
    }
  };

  const handlePrintInvoice = async (saleId: string, saleNum?: string) => {
    setPrintingSaleId(saleId);
    try {
      const { blob } = await apiDownload(`/sales/${saleId}/invoice`, {
        accessToken: tokens?.accessToken,
      });
      printBlob(blob, `Invoice ${saleNum || saleId}`);
    } catch (err: any) {
      setPageError(err?.message || "Failed to print tax invoice.");
    } finally {
      setPrintingSaleId(null);
    }
  };

  const handleDownloadInvoice = async (saleId: string, saleNum?: string) => {
    setDownloadingSaleId(saleId);
    try {
      const { blob, filename } = await apiDownload(`/sales/${saleId}/invoice`, {
        accessToken: tokens?.accessToken,
      });
      saveBlob(blob, filename || `Invoice-${saleNum || saleId}.pdf`);
    } catch (err: any) {
      setPageError(err?.message || "Failed to download tax invoice.");
    } finally {
      setDownloadingSaleId(null);
    }
  };

  // ── Copy helpers ──────────────────────────────────────────────────────────

  const copyText = (text: string, type: "trn" | "id") => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === "trn") {
      setCopiedTRN(true);
      setTimeout(() => setCopiedTRN(false), 2000);
    } else {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  // ── Modals Setup Handlers ────────────────────────────────────────────────

  const openPaymentModal = () => {
    if (!customer) return;
    const debt = parseFloat(customer.creditBalance || "0");
    setPayAmount(debt > 0 ? debt.toFixed(2) : "0.00");
    setPayMethod("cash");
    setPayRef("");
    setPayNotes("");
    if (branches.length > 0) {
      setPayBranchId(customer.branchId || branches[0]?.id || "");
    }
    setIsPaymentModalOpen(true);
  };

  const openEditModal = () => {
    if (!customer) return;
    setEditName(customer.name || "");
    setEditCompany(customer.company || "");
    setEditPhone(customer.phone || "");
    setEditWhatsapp(customer.whatsappPhone || "");
    setEditEmail(customer.email || "");
    setEditTrn(customer.trn || "");
    setEditAddress(customer.address || "");
    setEditType(customer.type || "retail");
    setEditLocale(customer.locale || "en");
    setEditTerms(String(customer.paymentTermDays || 0));
    setEditNotes(customer.notes || "");
    setIsEditModalOpen(true);
  };

  const openCreditModal = () => {
    if (!customer) return;
    setCreditLimitInput(customer.creditLimit || "0");
    setCreditOnHoldInput(customer.creditOnHold || false);
    setIsCreditModalOpen(true);
  };

  const openLoyaltyModal = () => {
    setLoyaltyPointsInput("50");
    setLoyaltyTypeInput("add");
    setLoyaltyReasonInput("");
    setIsLoyaltyModalOpen(true);
  };

  // ── Form Submissions ──────────────────────────────────────────────────────

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setPaySubmitting(true);
    setPageError(null);

    const amountNum = parseFloat(payAmount);
    if (!amountNum || amountNum <= 0) {
      setPageError("Payment amount must be greater than 0.");
      setPaySubmitting(false);
      return;
    }

    try {
      await api.post(
        `/customers/${customer.id}/payments`,
        {
          amount: amountNum,
          method: payMethod,
          branchId: payBranchId || branches[0]?.id || undefined,
          referenceNumber: payRef || undefined,
          notes: payNotes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );

      setSuccessMsg(`Payment of AED ${formatMoney(amountNum)} recorded successfully.`);
      setIsPaymentModalOpen(false);
      await loadCustomerData(true);
    } catch (err: any) {
      setPageError(err?.message || "Failed to record payment.");
    } finally {
      setPaySubmitting(false);
    }
  };

  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setEditSubmitting(true);
    setPageError(null);

    try {
      await api.patch(
        `/customers/${customer.id}`,
        {
          name: editName,
          company: editCompany || undefined,
          phone: editPhone || undefined,
          whatsappPhone: editWhatsapp || undefined,
          email: editEmail || undefined,
          trn: editTrn || undefined,
          address: editAddress || undefined,
          type: editType,
          locale: editLocale,
          paymentTermDays: parseInt(editTerms, 10) || 0,
          notes: editNotes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );

      setSuccessMsg("Customer details updated successfully.");
      setIsEditModalOpen(false);
      await loadCustomerData(true);
    } catch (err: any) {
      setPageError(err?.message || "Failed to update customer.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleAdjustCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setCreditSubmitting(true);
    setPageError(null);

    try {
      await api.patch(
        `/customers/${customer.id}/credit`,
        {
          creditLimit: parseFloat(creditLimitInput) || 0,
          creditOnHold: creditOnHoldInput,
        },
        { accessToken: tokens?.accessToken },
      );

      setSuccessMsg("Credit facility updated successfully.");
      setIsCreditModalOpen(false);
      await loadCustomerData(true);
    } catch (err: any) {
      setPageError(err?.message || "Failed to update credit terms.");
    } finally {
      setCreditSubmitting(false);
    }
  };

  const handleAdjustLoyalty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setLoyaltySubmitting(true);
    setPageError(null);

    const pts = parseInt(loyaltyPointsInput, 10) || 0;
    const finalPoints = loyaltyTypeInput === "add" ? Math.abs(pts) : -Math.abs(pts);

    try {
      await api.post(
        `/customers/${customer.id}/loyalty`,
        {
          points: finalPoints,
          reason: loyaltyReasonInput || "Manual admin adjustment",
        },
        { accessToken: tokens?.accessToken },
      );

      setSuccessMsg(
        `Loyalty balance adjusted by ${finalPoints > 0 ? `+${finalPoints}` : finalPoints} points.`,
      );
      setIsLoyaltyModalOpen(false);
      await loadCustomerData(true);
    } catch (err: any) {
      setPageError(err?.message || "Failed to adjust loyalty points.");
    } finally {
      setLoyaltySubmitting(false);
    }
  };

  // ── Filtered Sales ────────────────────────────────────────────────────────

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      const matchSearch =
        !invoiceSearch ||
        (s.saleNumber && s.saleNumber.toLowerCase().includes(invoiceSearch.toLowerCase())) ||
        (s.invoiceNumber && s.invoiceNumber.toLowerCase().includes(invoiceSearch.toLowerCase())) ||
        (s.cashierName && s.cashierName.toLowerCase().includes(invoiceSearch.toLowerCase()));
      const matchStatus =
        invoiceStatusFilter === "all" ||
        s.status?.toLowerCase() === invoiceStatusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [sales, invoiceSearch, invoiceStatusFilter]);

  // ── Combined Statement / Ledger ───────────────────────────────────────────

  interface LedgerRow {
    id: string;
    date: string;
    type: "invoice" | "payment";
    docNumber: string;
    description: string;
    branchName?: string;
    debit: number; // Invoice increase owed
    credit: number; // Payment decreases owed
    runningBalance: number;
    raw: any;
  }

  const statementLedger = useMemo(() => {
    const list: Array<{
      id: string;
      date: Date;
      type: "invoice" | "payment";
      docNumber: string;
      description: string;
      branchName?: string;
      debit: number;
      credit: number;
      raw: any;
    }> = [];

    // Add Sales (Invoices)
    sales.forEach((s) => {
      if (s.status === "void") return; // exclude voided from balance
      const totalNum = parseFloat(s.total || "0");
      list.push({
        id: `sale-${s.id}`,
        date: new Date(s.occurredAt || s.createdAt || Date.now()),
        type: "invoice",
        docNumber: s.saleNumber || s.invoiceNumber || "Invoice",
        description: `Tax Invoice (${s.status})`,
        branchName: s.branchName,
        debit: totalNum,
        credit: 0,
        raw: s,
      });
    });

    // Add Customer Payments
    payments.forEach((p) => {
      const amountNum = parseFloat(p.amount || "0");
      list.push({
        id: `pay-${p.id}`,
        date: new Date(p.createdAt || Date.now()),
        type: "payment",
        docNumber: p.referenceNumber ? `Ref: ${p.referenceNumber}` : "Account Payment",
        description: `Settlement via ${p.method.replace("_", " ")}${p.notes ? ` - ${p.notes}` : ""}`,
        branchName: branches.find((b) => b.id === p.branchId)?.name,
        debit: 0,
        credit: amountNum,
        raw: p,
      });
    });

    // Sort ascending chronologically to compute running balance
    list.sort((a, b) => a.date.getTime() - b.date.getTime());

    let currentBalance = 0;
    const computed: LedgerRow[] = list.map((item) => {
      currentBalance = currentBalance + item.debit - item.credit;
      return {
        id: item.id,
        date: item.date.toISOString(),
        type: item.type,
        docNumber: item.docNumber,
        description: item.description,
        branchName: item.branchName,
        debit: item.debit,
        credit: item.credit,
        runningBalance: currentBalance,
        raw: item.raw,
      };
    });

    // Return reversed so latest is top
    return computed.reverse();
  }, [sales, payments, branches]);

  // Total Lifetime Invoiced
  const totalLifetimeInvoiced = useMemo(() => {
    return sales
      .filter((s) => s.status !== "void")
      .reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
  }, [sales]);

  // Total Lifetime Payments
  const totalLifetimePaid = useMemo(() => {
    return payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  }, [payments]);

  // Credit metrics
  const creditLimit = parseFloat(customer?.creditLimit || "0");
  const creditBalance = parseFloat(customer?.creditBalance || "0");
  const availableCredit = Math.max(0, creditLimit - creditBalance);
  const creditUsagePct = creditLimit > 0 ? Math.min((creditBalance / creditLimit) * 100, 100) : 0;
  const isOverLimit = creditLimit > 0 && creditBalance > creditLimit;

  // ── Render Loading / Error ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm font-medium text-muted-foreground">Loading client profile & bills...</p>
      </div>
    );
  }

  if (pageError && !customer) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Customer Not Found</h2>
        <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
        <Link href="/customers" className="mt-6 inline-block">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Customers
          </Button>
        </Link>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-6 pb-12">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href="/customers"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Customers</span>
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground font-semibold truncate max-w-[200px] sm:max-w-xs">
            {customer.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadCustomerData(true)}
            disabled={refreshing}
            className="h-9"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
            Refresh
          </Button>

          {customer.whatsappPhone && (
            <a
              href={`https://wa.me/${customer.whatsappPhone.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                <MessageCircle className="h-4 w-4 mr-1.5 text-emerald-500" />
                WhatsApp
              </Button>
            </a>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsStatementModalOpen(true)}
            className="h-9"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Statement
          </Button>

          {canCreditCustomer && (
            <Button variant="outline" size="sm" onClick={openCreditModal} className="h-9">
              <Sliders className="h-3.5 w-3.5 mr-1.5" />
              Credit Facility
            </Button>
          )}

          {canWriteCustomer && (
            <Button variant="outline" size="sm" onClick={openEditModal} className="h-9">
              Edit Profile
            </Button>
          )}

          {canRecordPayment && (
            <Button
              size="sm"
              onClick={openPaymentModal}
              disabled={creditBalance <= 0}
              className="h-9 bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium shadow-xs"
            >
              <Banknote className="h-4 w-4 mr-1.5" />
              Settle / Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* ── Banners & Notifications ────────────────────────────────────────── */}
      {successMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-600 dark:text-emerald-400 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {pageError && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive animate-fade-in-up">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{pageError}</span>
          </div>
          <button onClick={() => setPageError(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {customer.creditOnHold && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
          <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-sm">Account on Credit Hold</p>
            <p className="text-muted-foreground mt-0.5">
              This client&apos;s credit has been temporarily placed on hold by management. POS
              terminals cannot approve credit sales for this account until unlocked.
            </p>
          </div>
        </div>
      )}

      {/* ── Client Profile Card Header ──────────────────────────────────────── */}
      <Card className="overflow-hidden border-border bg-card shadow-sm">
        <div className="bg-linear-to-r from-secondary/50 via-secondary/20 to-transparent p-6 sm:p-7 border-b border-border">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            {/* Identity */}
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 border-2 border-background shadow-md">
                <AvatarFallback
                  className={cn(
                    "bg-linear-to-br text-white text-lg font-bold shadow-inner",
                    TYPE_GRADIENT[customer.type] ?? "from-slate-500 to-slate-700",
                  )}
                >
                  {customer.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {customer.name}
                  </h1>
                  <Badge
                    variant={
                      customer.type === "wholesale"
                        ? "default"
                        : customer.type === "vip"
                          ? "warning"
                          : "secondary"
                    }
                    className="capitalize text-xs font-semibold px-2.5 py-0.5"
                  >
                    {customer.type}
                  </Badge>
                  {customer.isActive ? (
                    <Badge variant="success" className="text-[11px]">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[11px]">
                      Inactive
                    </Badge>
                  )}
                  {customer.creditOnHold && (
                    <Badge variant="destructive" className="text-[11px]">
                      Hold
                    </Badge>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {customer.company && (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {customer.company}
                    </span>
                  )}
                  {customer.trn && (
                    <button
                      type="button"
                      onClick={() => copyText(customer.trn!, "trn")}
                      className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-secondary/80 transition-colors"
                      title="Click to copy TRN"
                    >
                      <span>TRN: {customer.trn}</span>
                      {copiedTRN ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ID: {customer.id.slice(0, 8)}...
                    <button
                      onClick={() => copyText(customer.id, "id")}
                      className="ml-1 hover:text-foreground inline-block"
                      title="Copy full Customer UUID"
                    >
                      {copiedId ? (
                        <Check className="h-2.5 w-2.5 inline text-emerald-500" />
                      ) : (
                        <Copy className="h-2.5 w-2.5 inline text-muted-foreground" />
                      )}
                    </button>
                  </span>
                  <span>Joined {formatDate(customer.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* Quick Balance Highlight */}
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card/60 p-4 shadow-2xs">
              <div className="text-right">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Current Balance Due
                </span>
                <span
                  className={cn(
                    "text-2xl font-bold font-mono tracking-tight",
                    creditBalance > 0 ? "text-amber-500 dark:text-amber-400" : "text-emerald-500",
                  )}
                >
                  AED {formatMoney(creditBalance)}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">
                  {creditBalance > 0 ? "Requires Settlement" : "Zero Outstanding Balance"}
                </span>
              </div>
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                  creditBalance > 0
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-emerald-500/15 text-emerald-500",
                )}
              >
                <Wallet className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Client Profile Details Grid ─────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border p-6 text-xs">
          {/* Column 1: Contact */}
          <div className="space-y-3 pb-4 md:pb-0 md:pr-6">
            <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-primary" /> Contact Details
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Phone:</span>
                {customer.phone ? (
                  <a
                    href={`tel:${customer.phone}`}
                    className="font-medium text-foreground hover:text-primary transition-colors font-mono"
                  >
                    {customer.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">WhatsApp:</span>
                {customer.whatsappPhone ? (
                  <a
                    href={`https://wa.me/${customer.whatsappPhone.replace(/[^0-9]/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-mono"
                  >
                    <MessageCircle className="h-3 w-3" />
                    {customer.whatsappPhone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email:</span>
                {customer.email ? (
                  <a
                    href={`mailto:${customer.email}`}
                    className="font-medium text-foreground hover:text-primary transition-colors truncate max-w-[160px]"
                  >
                    {customer.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Address:</span>
                <span className="font-medium text-foreground text-right">
                  {customer.address || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Column 2: Account Terms & Setup */}
          <div className="space-y-3 py-4 md:py-0 md:px-6">
            <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-primary" /> Terms & Credit
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Credit Limit:</span>
                <span className="font-mono font-medium text-foreground">
                  AED {formatMoney(customer.creditLimit)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment Terms:</span>
                <span className="font-medium text-foreground">
                  {customer.paymentTermDays > 0
                    ? `${customer.paymentTermDays} Days`
                    : "Due on Receipt (Cash)"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Credit Standing:</span>
                <Badge
                  variant={
                    customer.creditOnHold
                      ? "destructive"
                      : isOverLimit
                        ? "warning"
                        : "success"
                  }
                  className="text-[10px]"
                >
                  {customer.creditOnHold
                    ? "On Hold"
                    : isOverLimit
                      ? "Over Limit"
                      : "Good Standing"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Default Branch:</span>
                <span className="font-medium text-foreground">
                  {branches.find((b) => b.id === customer.branchId)?.name || "All Branches"}
                </span>
              </div>
            </div>
          </div>

          {/* Column 3: Loyalty & Notes */}
          <div className="space-y-3 pt-4 md:pt-0 md:pl-6">
            <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-primary" /> Loyalty & Notes
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Loyalty Points:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-amber-500 font-mono text-sm">
                    {customer.loyaltyPoints.toLocaleString()} pts
                  </span>
                  {canCreditCustomer && (
                    <button
                      onClick={openLoyaltyModal}
                      className="text-[10px] text-primary hover:underline ml-1"
                    >
                      Adjust
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Language / Locale:</span>
                <span className="font-medium text-foreground uppercase">
                  {customer.locale || "en"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Notes:</span>
                <p className="text-[11px] text-foreground bg-secondary/40 rounded p-2 italic leading-relaxed">
                  {customer.notes || "No special instructions or internal notes."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── KPI Metric Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Credit Balance */}
        <Card className="p-4 border-border">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Outstanding Balance</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
            AED {formatMoney(creditBalance)}
          </p>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {creditLimit > 0
                ? `${Math.round(creditUsagePct)}% of credit limit`
                : "No credit facility"}
            </span>
            {creditBalance > 0 && (
              <Badge variant="warning" className="text-[10px] px-1.5">
                Unsettled
              </Badge>
            )}
          </div>
        </Card>

        {/* Metric 2: Available Credit */}
        <Card className="p-4 border-border">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Available Credit</span>
            <CreditCard className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
            AED {formatMoney(availableCredit)}
          </p>
          <div className="mt-2">
            <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  creditUsagePct > 90
                    ? "bg-red-500"
                    : creditUsagePct > 70
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ width: `${Math.min(creditUsagePct, 100)}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Metric 3: Lifetime Invoiced */}
        <Card className="p-4 border-border">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Lifetime Invoiced</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
            AED {formatMoney(totalLifetimeInvoiced)}
          </p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{sales.length} total orders/bills</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              Paid: AED {formatMoney(totalLifetimePaid)}
            </span>
          </div>
        </Card>

        {/* Metric 4: Loyalty Points */}
        <Card className="p-4 border-border">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Loyalty Rewards</span>
            <Award className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-mono tracking-tight text-amber-500">
            {customer.loyaltyPoints.toLocaleString()} <span className="text-sm font-normal">pts</span>
          </p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{loyaltyHistory.length} point transactions</span>
            <span className="capitalize">{customer.type} tier</span>
          </div>
        </Card>
      </div>

      {/* ── Tabs Navigation ─────────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <div className="flex items-center gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab("invoices")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer",
              activeTab === "invoices"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <FileText className="h-4 w-4" />
            <span>Bills & Invoices</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {sales.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab("payments")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer",
              activeTab === "payments"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Banknote className="h-4 w-4" />
            <span>Payments Received</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {payments.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab("statement")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer",
              activeTab === "statement"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Receipt className="h-4 w-4" />
            <span>Account Statement</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {statementLedger.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab("quotations")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer",
              activeTab === "quotations"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <FileCheck className="h-4 w-4" />
            <span>Quotations</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {quotations.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab("loyalty")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer",
              activeTab === "loyalty"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Coins className="h-4 w-4" />
            <span>Loyalty Ledger</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {loyaltyHistory.length}
            </Badge>
          </button>
        </div>
      </div>

      {/* ── Tab 1: Bills & Invoices ─────────────────────────────────────────── */}
      {activeTab === "invoices" && (
        <Card className="overflow-hidden border-border">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border bg-secondary/20">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by invoice # or cashier..."
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                className="pl-9 h-8 text-xs bg-background"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select value={invoiceStatusFilter} onValueChange={setInvoiceStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-32 bg-background">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredSales.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No Invoices Found</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {invoiceSearch || invoiceStatusFilter !== "all"
                  ? "No bills match the search filter."
                  : "This customer has no recorded sales or bills yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-4 py-3">Invoice #</th>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Cashier</th>
                    <th className="px-4 py-3 text-right">Total (AED)</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSales.map((s) => {
                    const dueNum = parseFloat(s.dueAmount || "0");
                    const totalNum = parseFloat(s.total || "0");
                    const paidNum = parseFloat(s.paidAmount || "0");
                    const isVoid = s.status === "void";

                    return (
                      <tr
                        key={s.id}
                        onClick={() => openBill(s)}
                        className="hover:bg-secondary/30 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3.5 font-mono font-semibold text-foreground group-hover:text-primary transition-colors">
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                            <span>{s.saleNumber || s.invoiceNumber || s.id.slice(0, 8)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                          {formatDateTime(s.occurredAt || s.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 text-foreground font-medium">
                          {s.branchName || "Main HQ"}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground font-mono">
                          {s.cashierName || "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-foreground">
                          {formatMoney(totalNum)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {formatMoney(paidNum)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold">
                          {dueNum > 0 ? (
                            <span className="text-amber-500">AED {formatMoney(dueNum)}</span>
                          ) : (
                            <span className="text-muted-foreground">0.00</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge
                            variant={
                              s.status === "completed"
                                ? "success"
                                : s.status === "void"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-[10px] capitalize"
                          >
                            {s.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => openBill(s)}
                              title="View Bill Lines & Details"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => handlePrintInvoice(s.id, s.saleNumber)}
                              disabled={printingSaleId === s.id}
                              title="Print A4 Tax Invoice"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              {printingSaleId === s.id && "..."}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => handleDownloadInvoice(s.id, s.saleNumber)}
                              disabled={downloadingSaleId === s.id}
                              title="Download PDF"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Tab 2: Payments Received ────────────────────────────────────────── */}
      {activeTab === "payments" && (
        <Card className="overflow-hidden border-border">
          <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Customer Payment History</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Every settlement applied against this client&apos;s credit account balance.
              </p>
            </div>
            {canRecordPayment && (
              <Button size="sm" onClick={openPaymentModal} className="h-8">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Record Payment
              </Button>
            )}
          </div>

          {payments.length === 0 ? (
            <div className="py-16 text-center">
              <Banknote className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No Payments Recorded</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                No credit account settlement payments have been recorded for this client.
              </p>
              {canRecordPayment && (
                <Button size="sm" onClick={openPaymentModal} className="mt-4">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Record First Payment
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-4 py-3">Receipt / Ref #</th>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Payment Method</th>
                    <th className="px-4 py-3 text-right">Amount (AED)</th>
                    <th className="px-4 py-3">Notes / Narration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((p) => {
                    const branch = branches.find((b) => b.id === p.branchId);
                    return (
                      <tr key={p.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3.5 font-mono font-medium text-foreground">
                          {p.referenceNumber || p.id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                          {formatDateTime(p.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 text-foreground">{branch?.name || "Main HQ"}</td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 capitalize font-medium text-foreground">
                            {PAYMENT_ICONS[p.method] ?? <Receipt className="h-3.5 w-3.5" />}
                            {p.method.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          AED {formatMoney(p.amount)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground italic">
                          {p.notes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Tab 3: Account Statement / Ledger ───────────────────────────────── */}
      {activeTab === "statement" && (
        <Card className="overflow-hidden border-border">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border bg-secondary/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Account Statement & Ledger</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complete chronological audit trail of bills (debits) and settlements (credits).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsStatementModalOpen(true)}
                className="h-8"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Print Formal Statement
              </Button>
            </div>
          </div>

          {statementLedger.length === 0 ? (
            <div className="py-16 text-center">
              <Receipt className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No Transactions</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                There are no invoices or payments in this customer&apos;s ledger.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Document / Ref</th>
                    <th className="px-4 py-3">Transaction Description</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3 text-right">Debit (+) Invoiced</th>
                    <th className="px-4 py-3 text-right">Credit (-) Paid</th>
                    <th className="px-4 py-3 text-right">Running Balance (AED)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {statementLedger.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => {
                        if (row.type === "invoice") openBill(row.raw);
                      }}
                      className={cn(
                        "hover:bg-secondary/30 transition-colors",
                        row.type === "invoice" && "cursor-pointer",
                      )}
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(row.date)}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          {row.type === "invoice" ? (
                            <FileText className="h-3.5 w-3.5 text-blue-500" />
                          ) : (
                            <Banknote className="h-3.5 w-3.5 text-emerald-500" />
                          )}
                          <span>{row.docNumber}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground">{row.description}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.branchName || "Main HQ"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground font-medium">
                        {row.debit > 0 ? `AED ${formatMoney(row.debit)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                        {row.credit > 0 ? `AED ${formatMoney(row.credit)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                        AED {formatMoney(row.runningBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Tab 4: Quotations ───────────────────────────────────────────────── */}
      {activeTab === "quotations" && (
        <Card className="overflow-hidden border-border">
          <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Quotations & Price Estimates</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Saved proforma invoices and price quotes issued to this customer.
              </p>
            </div>
            <Link href="/quotations">
              <Button variant="outline" size="sm" className="h-8">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Quote
              </Button>
            </Link>
          </div>

          {quotations.length === 0 ? (
            <div className="py-16 text-center">
              <FileCheck className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No Quotations Found</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                No quotations have been prepared for this client.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-4 py-3">Quote #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Valid Until</th>
                    <th className="px-4 py-3 text-right">Total (AED)</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quotations.map((q) => (
                    <tr key={q.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3.5 font-mono font-semibold text-foreground">
                        {q.quotationNumber}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                        {formatDate(q.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                        {q.expiresAt ? formatDate(q.expiresAt) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-foreground">
                        AED {formatMoney(q.total)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Badge
                          variant={
                            q.status === "accepted" || q.status === "converted"
                              ? "success"
                              : q.status === "expired"
                                ? "destructive"
                                : "secondary"
                          }
                          className="capitalize text-[10px]"
                        >
                          {q.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={async () => {
                            try {
                              const { blob, filename } = await apiDownload(
                                `/quotations/${q.id}/pdf`,
                                { accessToken: tokens?.accessToken },
                              );
                              printBlob(blob, `Quote ${q.quotationNumber}`);
                            } catch (err: any) {
                              setPageError(err?.message || "Failed to download quotation PDF.");
                            }
                          }}
                        >
                          <Printer className="h-3 w-3 mr-1" /> Print
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Tab 5: Loyalty Ledger ───────────────────────────────────────────── */}
      {activeTab === "loyalty" && (
        <Card className="overflow-hidden border-border">
          <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Loyalty Rewards Points Ledger</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Points accrued on purchases and redeemed for discounts.
              </p>
            </div>
            {canCreditCustomer && (
              <Button size="sm" onClick={openLoyaltyModal} className="h-8">
                <Sliders className="h-3.5 w-3.5 mr-1.5" />
                Adjust Points
              </Button>
            )}
          </div>

          {loyaltyHistory.length === 0 ? (
            <div className="py-16 text-center">
              <Coins className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No Loyalty Transactions</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                No loyalty points have been earned or redeemed yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Action Type</th>
                    <th className="px-4 py-3 text-right">Points</th>
                    <th className="px-4 py-3">Reference / Source</th>
                    <th className="px-4 py-3">Notes & Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loyaltyHistory.map((rec) => (
                    <tr key={rec.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(rec.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 capitalize font-medium text-foreground">
                        <Badge
                          variant={rec.type === "earned" ? "success" : "warning"}
                          className="text-[10px]"
                        >
                          {rec.type}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 text-right font-mono font-bold text-sm",
                          rec.points > 0 ? "text-emerald-500" : "text-amber-500",
                        )}
                      >
                        {rec.points > 0 ? `+${rec.points}` : rec.points}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground font-mono">
                        {rec.referenceType || "Manual"}
                      </td>
                      <td className="px-4 py-3.5 text-foreground italic">
                        {rec.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Bill Details Modal ──────────────────────────────────────────────── */}
      <Dialog open={selectedSale !== null} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-700 text-white shadow-xs">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="font-mono text-lg">
                    {selectedSale?.saleNumber || selectedSale?.invoiceNumber || "Tax Invoice"}
                  </DialogTitle>
                  <DialogDescription>
                    {formatDateTime(selectedSale?.occurredAt || selectedSale?.createdAt)} ·{" "}
                    {selectedSale?.branchName || "Store Terminal"}
                  </DialogDescription>
                </div>
              </div>
              <Badge
                variant={
                  selectedSale?.status === "completed"
                    ? "success"
                    : selectedSale?.status === "void"
                      ? "destructive"
                      : "secondary"
                }
                className="text-xs capitalize px-2.5 py-1"
              >
                {selectedSale?.status}
              </Badge>
            </div>
          </DialogHeader>

          {selectedSale?.voidedAt && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>This invoice was voided on {formatDateTime(selectedSale.voidedAt)}.</span>
            </div>
          )}

          {/* Customer & Cashier Info bar */}
          <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border p-3.5 bg-secondary/20 text-xs">
            <div>
              <span className="text-muted-foreground text-[10px] uppercase font-semibold">
                Client / Account
              </span>
              <p className="font-semibold text-foreground text-sm mt-0.5">{customer.name}</p>
              {customer.company && <p className="text-muted-foreground">{customer.company}</p>}
              {customer.trn && (
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                  TRN: {customer.trn}
                </p>
              )}
            </div>
            <div>
              <span className="text-muted-foreground text-[10px] uppercase font-semibold">
                Cashier & Branch
              </span>
              <p className="font-semibold text-foreground text-sm mt-0.5">
                {selectedSale?.cashierName || "POS Cashier"}
              </p>
              <p className="text-muted-foreground">{selectedSale?.branchName || "Main Branch"}</p>
            </div>
          </div>

          {/* Line items table */}
          <div className="rounded-xl border border-border overflow-hidden">
            {billLoading && !selectedSale?.items ? (
              <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Loading line items...
              </div>
            ) : (selectedSale?.items ?? []).length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No items recorded in this bill.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-secondary/50 text-muted-foreground font-medium">
                    <tr>
                      <th className="px-3.5 py-2.5">Item & Variant</th>
                      <th className="px-3.5 py-2.5 text-right">Qty</th>
                      <th className="px-3.5 py-2.5 text-right">Unit Price</th>
                      <th className="px-3.5 py-2.5 text-right">Disc %</th>
                      <th className="px-3.5 py-2.5 text-right">VAT %</th>
                      <th className="px-3.5 py-2.5 text-right">Total (AED)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedSale?.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3.5 py-2.5">
                          <p className="font-semibold text-foreground">
                            {item.productName}
                            {item.variantName && item.variantName !== "Default"
                              ? ` — ${item.variantName}`
                              : ""}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            SKU: {item.productSku}
                          </p>
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-medium">
                          {item.quantity}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                          {formatMoney(item.unitPrice)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                          {item.discountPercent ? `${item.discountPercent}%` : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                          {item.taxPercent}%
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-bold text-foreground">
                          {formatMoney(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Financial Breakdown & Tender */}
          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            {/* Tender / Payment breakdown */}
            <div className="rounded-xl border border-border p-3.5 space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Payment Method & Tender
              </span>
              {(selectedSale?.payments ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No payments logged.</p>
              ) : (
                <div className="space-y-1">
                  {selectedSale?.payments?.map((pm, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 capitalize text-foreground">
                        {PAYMENT_ICONS[pm.method] ?? <CreditCard className="h-3.5 w-3.5" />}
                        {pm.method.replace("_", " ")}
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        AED {formatMoney(pm.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {selectedSale?.notes && (
                <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
                  <span className="font-semibold">Notes:</span> {selectedSale.notes}
                </div>
              )}
            </div>

            {/* Totals Summary */}
            <div className="rounded-xl border border-border p-3.5 space-y-1.5 text-xs bg-secondary/10">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal (Excl. VAT):</span>
                <span className="font-mono font-medium text-foreground">
                  AED {formatMoney(selectedSale?.subtotal)}
                </span>
              </div>
              {selectedSale?.discountAmount && parseFloat(selectedSale.discountAmount) > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Document Discount:</span>
                  <span className="font-mono">-AED {formatMoney(selectedSale.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>VAT / Tax (5%):</span>
                <span className="font-mono font-medium text-foreground">
                  AED {formatMoney(selectedSale?.taxAmount)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
                <span>Total Invoice Amount:</span>
                <span className="font-mono text-base">AED {formatMoney(selectedSale?.total)}</span>
              </div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Amount Paid:</span>
                <span className="font-mono font-medium">
                  AED {formatMoney(selectedSale?.paidAmount)}
                </span>
              </div>
              {selectedSale?.dueAmount && parseFloat(selectedSale.dueAmount) > 0 && (
                <div className="flex justify-between text-amber-500 font-semibold border-t border-border pt-1">
                  <span>Balance Due:</span>
                  <span className="font-mono">AED {formatMoney(selectedSale.dueAmount)}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => handleDownloadInvoice(selectedSale!.id, selectedSale?.saleNumber)}
              disabled={downloadingSaleId === selectedSale?.id}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download PDF
            </Button>
            <Button
              onClick={() => handlePrintInvoice(selectedSale!.id, selectedSale?.saleNumber)}
              disabled={printingSaleId === selectedSale?.id}
            >
              <Printer className="h-4 w-4 mr-1.5" />
              Print Tax Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Payment Modal ─────────────────────────────────────────────── */}
      <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-emerald-600 to-teal-700 text-white shadow-xs">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle>Settle Credit Account</DialogTitle>
                <DialogDescription>Record a payment received from {customer.name}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs">
              <span className="text-muted-foreground block">Total Outstanding Debt</span>
              <span className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                AED {formatMoney(creditBalance)}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Payment Amount (AED) *
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={creditBalance > 0 ? creditBalance : undefined}
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
                className="font-mono text-base font-bold"
              />
              {creditBalance > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setPayAmount(creditBalance.toFixed(2))}
                  >
                    Full Balance (AED {formatMoney(creditBalance)})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setPayAmount((creditBalance / 2).toFixed(2))}
                  >
                    50%
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Payment Method *
                </label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card (POS)</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Branch *</label>
                <Select value={payBranchId} onValueChange={setPayBranchId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Reference # (Cheque / Bank Auth code)
              </label>
              <Input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. CHQ-99210 or TXN-4882"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Notes</label>
              <Input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Optional payment remarks..."
                className="text-xs"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPaymentModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={paySubmitting}
                className="bg-linear-to-r from-emerald-600 to-teal-600 text-white"
              >
                {paySubmitting ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Customer Modal ──────────────────────────────────────────────── */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Customer Profile</DialogTitle>
            <DialogDescription>Update contact information, trade terms, and TRN</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditCustomer} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Full Name *</label>
                <Input
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Tariq Al-Nuaimi"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Company</label>
                <Input
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="e.g. Al Falaj Contracting"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Phone</label>
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+971 50 123 4567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  WhatsApp Number
                </label>
                <Input
                  value={editWhatsapp}
                  onChange={(e) => setEditWhatsapp(e.target.value)}
                  placeholder="+971 50 123 4567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Email</label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="contact@company.ae"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">TRN</label>
                <Input
                  value={editTrn}
                  onChange={(e) => setEditTrn(e.target.value)}
                  placeholder="100234567800003"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Tier / Type</label>
                <Select
                  value={editType}
                  onValueChange={(val) => setEditType(val as "retail" | "wholesale" | "vip")}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="wholesale">Wholesale</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Locale</label>
                <Select
                  value={editLocale}
                  onValueChange={(val) => setEditLocale(val as "en" | "ar")}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English (en)</SelectItem>
                    <SelectItem value="ar">Arabic (ar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Payment Terms (Days)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="365"
                  value={editTerms}
                  onChange={(e) => setEditTerms(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Physical Address</label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="Industrial Area 4, Sharjah, UAE"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Internal Notes</label>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Important account notes or delivery instructions..."
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Adjust Credit Facility Modal ─────────────────────────────────────── */}
      <Dialog open={isCreditModalOpen} onOpenChange={setIsCreditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-amber-500 to-orange-600 text-white shadow-xs">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle>Credit Facility Terms</DialogTitle>
                <DialogDescription>Modify credit limit and hold status for {customer.name}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleAdjustCredit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Credit Limit (AED)
              </label>
              <Input
                type="number"
                min="0"
                step="100"
                required
                value={creditLimitInput}
                onChange={(e) => setCreditLimitInput(e.target.value)}
                className="font-mono font-bold text-base"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Set to 0 for cash-only purchases with no credit line.
              </p>
            </div>

            <div className="rounded-xl border border-border p-4 bg-secondary/30 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-foreground text-xs block">
                    Credit on Hold
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Disallow any further credit sales at POS
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={creditOnHoldInput}
                  onChange={(e) => setCreditOnHoldInput(e.target.checked)}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creditSubmitting}>
                {creditSubmitting ? "Updating..." : "Update Credit Terms"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Adjust Loyalty Points Modal ──────────────────────────────────────── */}
      <Dialog open={isLoyaltyModalOpen} onOpenChange={setIsLoyaltyModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-amber-500 to-yellow-600 text-white shadow-xs">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle>Adjust Loyalty Points</DialogTitle>
                <DialogDescription>
                  Current Balance: {customer.loyaltyPoints.toLocaleString()} points
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleAdjustLoyalty} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={loyaltyTypeInput === "add" ? "default" : "outline"}
                className={cn("text-xs", loyaltyTypeInput === "add" && "bg-emerald-600 text-white")}
                onClick={() => setLoyaltyTypeInput("add")}
              >
                + Grant Points
              </Button>
              <Button
                type="button"
                variant={loyaltyTypeInput === "redeem" ? "default" : "outline"}
                className={cn("text-xs", loyaltyTypeInput === "redeem" && "bg-amber-600 text-white")}
                onClick={() => setLoyaltyTypeInput("redeem")}
              >
                - Redeem / Deduct
              </Button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Points Amount
              </label>
              <Input
                type="number"
                min="1"
                required
                value={loyaltyPointsInput}
                onChange={(e) => setLoyaltyPointsInput(e.target.value)}
                className="font-mono text-base font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Reason / Note *
              </label>
              <Input
                required
                value={loyaltyReasonInput}
                onChange={(e) => setLoyaltyReasonInput(e.target.value)}
                placeholder="e.g. Promotional VIP reward or manual compensation"
                className="text-xs"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsLoyaltyModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loyaltySubmitting}>
                {loyaltySubmitting ? "Adjusting..." : "Confirm Adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Printable Statement Modal ─────────────────────────────────────────── */}
      <Dialog open={isStatementModalOpen} onOpenChange={setIsStatementModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <DialogTitle className="text-xl">Statement of Account</DialogTitle>
              <DialogDescription>
                Generated on {new Date().toLocaleDateString("en-AE")}
              </DialogDescription>
            </div>
            <Button size="sm" onClick={() => window.print()} className="h-8">
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
          </div>

          {/* Statement Document Preview */}
          <div className="space-y-6 pt-4 text-xs">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-secondary/10">
              <div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">
                  Statement For
                </span>
                <p className="text-base font-bold text-foreground mt-0.5">{customer.name}</p>
                {customer.company && <p className="text-muted-foreground">{customer.company}</p>}
                {customer.phone && <p className="font-mono text-muted-foreground">{customer.phone}</p>}
                {customer.trn && (
                  <p className="font-mono text-muted-foreground">TRN: {customer.trn}</p>
                )}
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">
                  Account Standing
                </span>
                <p className="text-2xl font-bold font-mono text-foreground mt-0.5">
                  AED {formatMoney(creditBalance)}
                </p>
                <p className="text-muted-foreground">Credit Limit: AED {formatMoney(creditLimit)}</p>
                <p className="text-muted-foreground">
                  Available: AED {formatMoney(availableCredit)}
                </p>
              </div>
            </div>

            {/* Summary statistics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <span className="text-muted-foreground text-[10px] uppercase font-semibold">
                  Total Invoiced
                </span>
                <p className="text-sm font-bold font-mono text-foreground mt-1">
                  AED {formatMoney(totalLifetimeInvoiced)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <span className="text-muted-foreground text-[10px] uppercase font-semibold">
                  Total Payments
                </span>
                <p className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  AED {formatMoney(totalLifetimePaid)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <span className="text-muted-foreground text-[10px] uppercase font-semibold">
                  Net Balance Due
                </span>
                <p className="text-sm font-bold font-mono text-amber-500 mt-1">
                  AED {formatMoney(creditBalance)}
                </p>
              </div>
            </div>

            {/* Statement Table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-3.5 py-2">Date</th>
                    <th className="px-3.5 py-2">Document / Reference</th>
                    <th className="px-3.5 py-2">Description</th>
                    <th className="px-3.5 py-2 text-right">Debit (+)</th>
                    <th className="px-3.5 py-2 text-right">Credit (-)</th>
                    <th className="px-3.5 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {statementLedger.slice(0, 50).map((row) => (
                    <tr key={row.id}>
                      <td className="px-3.5 py-2 text-muted-foreground">
                        {formatDate(row.date)}
                      </td>
                      <td className="px-3.5 py-2 text-foreground font-medium">{row.docNumber}</td>
                      <td className="px-3.5 py-2 font-sans text-muted-foreground">
                        {row.description}
                      </td>
                      <td className="px-3.5 py-2 text-right text-foreground">
                        {row.debit > 0 ? formatMoney(row.debit) : "—"}
                      </td>
                      <td className="px-3.5 py-2 text-right text-emerald-600 dark:text-emerald-400">
                        {row.credit > 0 ? formatMoney(row.credit) : "—"}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold text-foreground">
                        {formatMoney(row.runningBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-center text-[10px] text-muted-foreground">
              Thank you for your business. For any statement inquiries, please contact our
              accounts department.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
