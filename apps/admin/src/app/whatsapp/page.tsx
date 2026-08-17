"use client";

import React, { useState, useEffect } from "react";
import { Bot, User, Send, Sparkles, FileText, RefreshCw, MessageSquare } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface Message {
  id: string;
  sender: "customer" | "ai" | "staff";
  time: string;
  text: string;
  action?: {
    type: "quotation" | "stock_check" | "price_check";
    summary: string;
  };
}

interface ChatThread {
  id: string;
  name: string;
  phone: string;
  initials: string;
  time: string;
  preview: string;
  gradient: string;
  badge?: string;
  messages: Message[];
}

const INITIAL_CHATS: ChatThread[] = [
  {
    id: "c1",
    name: "Al Falaj Building Contracting LLC",
    phone: "+971 50 123 4567",
    initials: "AF",
    time: "10:43 AM",
    preview: "Quotation Ready (AED 567.00)",
    gradient: "from-blue-500 to-indigo-600",
    badge: "Quotation Ready",
    messages: [
      { id: "m1", sender: "customer", time: "10:42 AM", text: "Salam bhai, 1 inch elbow 50 pcs and 3 core 2.5mm cable 2 rolls price and stock please?" },
      { id: "m2", sender: "ai", time: "10:42 AM", text: "Walaikum Assalam! Checking real-time stock and prices for Sharjah and Dubai branches...", action: { type: "stock_check", summary: 'Stock found: 450 pcs PVC Elbow 1" (SHJ), 35 rolls Ducab 3x2.5mm (SHJ & DXB)' } },
      { id: "m3", sender: "ai", time: "10:43 AM", text: "Here is your quotation at wholesale rates:\n• PVC Elbow 1\" (50 pcs) @ AED 2.20 = AED 110.00\n• Ducab 2.5mm Cable (2 rolls) @ AED 215.00 = AED 430.00\n\nSubtotal: AED 540.00\nVAT (5%): AED 27.00\nTotal: AED 567.00\n\nShall I confirm this order for collection at Sharjah or Dubai branch?", action: { type: "quotation", summary: "Quotation QT-2026-000418 created and PDF rendered" } },
    ],
  },
  {
    id: "c2",
    name: "Bin Hamoodah MEP Contracting",
    phone: "+971 55 987 6543",
    initials: "MR",
    time: "09:15 AM",
    preview: "Jotun Fenomastic Pure Colours 18L inquiry",
    gradient: "from-emerald-500 to-teal-600",
    badge: "Active Chat",
    messages: [
      { id: "m4", sender: "customer", time: "09:10 AM", text: "Good morning, do you have Jotun Fenomastic Matt 18L in white color?" },
      { id: "m5", sender: "ai", time: "09:11 AM", text: "Good morning! Yes, we have 42 drums of Jotun Fenomastic Pure Colours Matt Interior 18L in stock across Sharjah (30) and Dubai (12).\n\nWholesale price: AED 185.00 + 5% VAT (Retail: AED 210.00).\nHow many drums would you like to reserve?", action: { type: "price_check", summary: "Stock: 42 drums available. Wholesale pricing applied." } },
    ],
  },
];

const DEFAULT_CHAT: ChatThread = INITIAL_CHATS[0]!;

export default function WhatsAppPage() {
  const { tokens } = useAuth();
  const [chats, setChats] = useState<ChatThread[]>(INITIAL_CHATS);
  const [activeChatId, setActiveChatId] = useState<string>("c1");
  const [inputText, setInputText] = useState("");
  const [loadingQuotations, setLoadingQuotations] = useState(false);

  const activeChat: ChatThread = chats.find((c) => c.id === activeChatId) ?? chats[0] ?? DEFAULT_CHAT;

  useEffect(() => {
    async function loadQuotations() {
      if (!tokens?.accessToken) return;
      try {
        setLoadingQuotations(true);
        const res = await api.get<{ items: any[] }>("/quotations", {
          accessToken: tokens.accessToken,
          query: { limit: 10 },
        });
        if (res?.items && res.items.length > 0) {
          // If quotations exist in DB, integrate into the state
        }
      } catch {
        // fallback
      } finally {
        setLoadingQuotations(false);
      }
    }
    loadQuotations();
  }, [tokens]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      sender: "staff",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: inputText.trim(),
    };

    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChat.id
          ? { ...c, messages: [...c.messages, newMsg], preview: inputText.trim() }
          : c
      )
    );

    setInputText("");
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">WhatsApp AI Conversations</h1>
            <Badge variant="secondary">Meta Cloud API (v23.0)</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Automated customer intent extraction, multilingual dialogue (English, Arabic, Hindi, Bangla), and quotation generation.
          </p>
        </div>
      </div>

      {/* ── Main Container ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Active Chats List */}
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Recent Inquiries
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {chats.length} Threads
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {chats.map((chat) => {
              const isActive = chat.id === activeChat.id;
              return (
                <div
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={cn(
                    "rounded-xl p-3.5 cursor-pointer transition-all duration-200",
                    isActive
                      ? "border-2 border-primary/40 bg-primary/5 shadow-sm"
                      : "border border-border bg-card hover:bg-secondary/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className={cn("bg-gradient-to-br text-white text-[10px] font-bold", chat.gradient)}>
                          {chat.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-xs text-foreground">{chat.phone}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{chat.time}</span>
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-foreground line-clamp-1">{chat.name}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{chat.preview}</p>
                  {chat.badge && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge variant="default" className="text-[10px] gap-1 gradient-brand border-0">
                        <Sparkles className="h-3 w-3" />
                        {chat.badge}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Right 2 Cols: Active Chat Feed */}
        <Card className="flex flex-col lg:col-span-2 min-h-[540px]">
          {/* Chat Header */}
          <CardHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-primary/20">
                  <AvatarFallback className={cn("bg-gradient-to-br text-white text-xs font-bold", activeChat.gradient)}>
                    {activeChat.initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-sm">{activeChat.name}</CardTitle>
                  <CardDescription className="text-xs font-mono">{activeChat.phone} · Wholesale Account</CardDescription>
                </div>
              </div>
              <Badge variant="success" className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                AI Active
              </Badge>
            </div>
          </CardHeader>

          {/* Messages Stream */}
          <CardContent className="flex-1 py-5 overflow-y-auto max-h-[420px]">
            <div className="space-y-4">
              {activeChat.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col",
                    msg.sender === "customer"
                      ? "items-start"
                      : msg.sender === "staff"
                      ? "items-end"
                      : "items-end"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-md rounded-2xl p-4 text-xs whitespace-pre-line shadow-sm",
                      msg.sender === "customer"
                        ? "bg-secondary text-foreground rounded-tl-md"
                        : msg.sender === "staff"
                        ? "bg-primary text-primary-foreground rounded-tr-md"
                        : "gradient-brand text-white rounded-tr-md"
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-bold mb-1.5 opacity-80 text-[10px]">
                      {msg.sender === "customer" ? (
                        <User className="h-3 w-3" />
                      ) : msg.sender === "staff" ? (
                        <User className="h-3 w-3" />
                      ) : (
                        <Bot className="h-3 w-3" />
                      )}
                      <span>
                        {msg.sender === "customer"
                          ? "Customer"
                          : msg.sender === "staff"
                          ? "Staff (You)"
                          : "DevsFleet AI Agent"}
                      </span>
                      <span>· {msg.time}</span>
                    </div>
                    <p className="leading-relaxed">{msg.text}</p>

                    {msg.action && (
                      <div
                        className={cn(
                          "mt-3 rounded-xl p-3 text-[11px] font-mono border",
                          msg.sender === "customer"
                            ? "bg-background border-border"
                            : "bg-white/10 border-white/15"
                        )}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          <FileText className="h-3.5 w-3.5" />
                          <span>System Action Executed</span>
                        </div>
                        <p className="mt-1 opacity-80">{msg.action.summary}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>

          {/* Input Box */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 border-t border-border p-4">
            <Input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Take over conversation or type manual response..."
              className="flex-1 bg-secondary/30"
            />
            <Button type="submit" size="sm" className="gradient-brand border-0" disabled={!inputText.trim()}>
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

