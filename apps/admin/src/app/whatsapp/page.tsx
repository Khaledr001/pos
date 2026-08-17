"use client";

import React from "react";
import { Bot, User, Send, Sparkles, FileText, Phone } from "lucide-react";
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

const SAMPLE_CONVO: Message[] = [
  { id: "m1", sender: "customer", time: "10:42 AM", text: "Salam bhai, 1 inch elbow 50 pcs and 3 core 2.5mm cable 2 rolls price and stock please?" },
  { id: "m2", sender: "ai", time: "10:42 AM", text: "Walaikum Assalam! Checking real-time stock and prices for Sharjah and Dubai branches...", action: { type: "stock_check", summary: 'Stock found: 450 pcs PVC Elbow 1" (SHJ), 35 rolls Ducab 3x2.5mm (SHJ & DXB)' } },
  { id: "m3", sender: "ai", time: "10:43 AM", text: "Here is your quotation at wholesale rates:\n• PVC Elbow 1\" (50 pcs) @ AED 2.20 = AED 110.00\n• Ducab 2.5mm Cable (2 rolls) @ AED 215.00 = AED 430.00\n\nSubtotal: AED 540.00\nVAT (5%): AED 27.00\nTotal: AED 567.00\n\nShall I confirm this order for collection at Sharjah or Dubai branch?", action: { type: "quotation", summary: "Quotation QT-2026-000418 created and PDF rendered" } },
];

export default function WhatsAppPage() {
  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">WhatsApp AI Conversations</h1>
          <Badge variant="secondary">Meta Cloud API (v23.0)</Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Automated customer intent extraction, multilingual dialogue (English, Arabic, Hindi, Bangla), and quotation generation.
        </p>
      </div>

      {/* ── Main Container ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Active Chats List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Inquiries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Active Chat */}
            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3.5 cursor-pointer transition-all hover:bg-primary/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-bold">AF</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-xs text-foreground">+971 50 123 4567</span>
                </div>
                <span className="text-[10px] text-muted-foreground">10:43 AM</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-1">Al Falaj Building Contracting LLC</p>
              <div className="mt-2 flex items-center gap-1.5">
                <Badge variant="default" className="text-[10px] gap-1 gradient-brand border-0">
                  <Sparkles className="h-3 w-3" />
                  Quotation Ready (AED 567.00)
                </Badge>
              </div>
            </div>

            {/* Inactive Chat */}
            <div className="rounded-xl border border-border bg-card p-3.5 hover:bg-secondary/50 transition-colors cursor-pointer opacity-70 hover:opacity-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-secondary text-muted-foreground text-[10px] font-bold">MR</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-xs text-foreground">+971 55 987 6543</span>
                </div>
                <span className="text-[10px] text-muted-foreground">09:15 AM</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-1">Jotun Pure Colours 18L enquiry</p>
            </div>
          </CardContent>
        </Card>

        {/* Right 2 Cols: Active Chat Feed */}
        <Card className="flex flex-col lg:col-span-2 min-h-[520px]">
          {/* Chat Header */}
          <CardHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-primary/20">
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold">AF</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-sm">Al Falaj Building Contracting LLC</CardTitle>
                  <CardDescription className="text-xs font-mono">+971 50 123 4567 · Wholesale Tier</CardDescription>
                </div>
              </div>
              <Badge variant="success" className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                AI Automated
              </Badge>
            </div>
          </CardHeader>

          {/* Messages Stream */}
          <CardContent className="flex-1 py-5 overflow-y-auto">
            <div className="space-y-4">
              {SAMPLE_CONVO.map((msg) => (
                <div key={msg.id} className={cn("flex flex-col", msg.sender === "customer" ? "items-start" : "items-end")}>
                  <div className={cn(
                    "max-w-md rounded-2xl p-4 text-xs whitespace-pre-line shadow-sm",
                    msg.sender === "customer"
                      ? "bg-secondary text-foreground rounded-tl-md"
                      : "gradient-brand text-white rounded-tr-md",
                  )}>
                    <div className="flex items-center gap-1.5 font-bold mb-1.5 opacity-80 text-[10px]">
                      {msg.sender === "customer" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      <span>{msg.sender === "customer" ? "Customer" : "DevsFleet AI Agent"}</span>
                      <span>· {msg.time}</span>
                    </div>
                    <p className="leading-relaxed">{msg.text}</p>

                    {msg.action && (
                      <div className={cn(
                        "mt-3 rounded-xl p-3 text-[11px] font-mono border",
                        msg.sender === "customer"
                          ? "bg-background border-border"
                          : "bg-white/10 border-white/15",
                      )}>
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
          <div className="flex items-center gap-2 border-t border-border p-4">
            <Input
              type="text"
              placeholder="Take over conversation or type manual response..."
              className="flex-1 bg-secondary/30"
            />
            <Button size="sm" className="gradient-brand border-0">
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
