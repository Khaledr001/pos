"use client";

import React, { useState } from "react";
import {
  MessageSquare,
  Bot,
  User,
  Send,
  Sparkles,
  FileText,
  Clock,
  Phone,
  CheckCheck,
} from "lucide-react";

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
  {
    id: "m1",
    sender: "customer",
    time: "10:42 AM",
    text: "Salam bhai, 1 inch elbow 50 pcs and 3 core 2.5mm cable 2 rolls price and stock please?",
  },
  {
    id: "m2",
    sender: "ai",
    time: "10:42 AM",
    text: "Walaikum Assalam! Checking real-time stock and prices for Sharjah and Dubai branches...",
    action: {
      type: "stock_check",
      summary: "Stock found: 450 pcs PVC Elbow 1\" (SHJ), 35 rolls Ducab 3x2.5mm (SHJ & DXB)",
    },
  },
  {
    id: "m3",
    sender: "ai",
    time: "10:43 AM",
    text: "Here is your quotation at wholesale rates:\n• PVC Elbow 1\" (50 pcs) @ AED 2.20 = AED 110.00\n• Ducab 2.5mm Cable (2 rolls) @ AED 215.00 = AED 430.00\n\nSubtotal: AED 540.00\nVAT (5%): AED 27.00\nTotal: AED 567.00\n\nShall I confirm this order for collection at Sharjah or Dubai branch?",
    action: {
      type: "quotation",
      summary: "Quotation QT-2026-000418 created and PDF rendered",
    },
  },
];

export default function WhatsAppPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              WhatsApp AI Conversations
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              Meta Cloud API (v23.0)
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Automated customer intent extraction, multilingual dialogue (English, Arabic, Hindi, Bangla), and quotation generation.
          </p>
        </div>
      </div>

      {/* Main Container */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Active Chats List */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-3">
            Recent Inquiries
          </h2>

          <div className="space-y-2">
            <div className="rounded-lg border border-[--color-brand]/40 bg-[--color-brand]/5 p-3 cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-xs text-[--color-fg]">
                  <Phone className="h-3.5 w-3.5 text-[--color-brand]" />
                  <span>+971 50 123 4567</span>
                </div>
                <span className="text-[10px] text-[--color-muted]">10:43 AM</span>
              </div>
              <p className="mt-1 text-[11px] text-[--color-muted] line-clamp-1">
                Al Falaj Building Contracting LLC
              </p>
              <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[--color-brand]">
                <Sparkles className="h-3 w-3" />
                <span>Quotation Ready (AED 567.00)</span>
              </div>
            </div>

            <div className="rounded-lg border border-[--color-border] bg-[--color-bg] p-3 hover:bg-[--color-surface] transition-colors cursor-pointer opacity-75">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-xs text-[--color-fg]">
                  <Phone className="h-3.5 w-3.5 text-[--color-muted]" />
                  <span>+971 55 987 6543</span>
                </div>
                <span className="text-[10px] text-[--color-muted]">09:15 AM</span>
              </div>
              <p className="mt-1 text-[11px] text-[--color-muted] line-clamp-1">
                Jotun Pure Colours 18L enquiry
              </p>
            </div>
          </div>
        </div>

        {/* Right 2 Cols: Active Chat Feed */}
        <div className="flex flex-col justify-between rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm lg:col-span-2 min-h-[500px]">
          {/* Chat Header */}
          <div className="flex items-center justify-between border-b border-[--color-border] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[--color-brand]/10 text-[--color-brand] font-bold text-xs">
                AF
              </div>
              <div>
                <h3 className="text-sm font-bold text-[--color-fg]">
                  Al Falaj Building Contracting LLC
                </h3>
                <span className="text-xs text-[--color-muted] font-mono">
                  +971 50 123 4567 · Wholesale Tier
                </span>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 rounded-full bg-[--color-success]/10 px-2.5 py-0.5 text-[11px] font-medium text-[--color-success]">
              <Sparkles className="h-3 w-3" />
              AI Automated
            </span>
          </div>

          {/* Messages Stream */}
          <div className="my-4 flex-1 space-y-4 overflow-y-auto">
            {SAMPLE_CONVO.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === "customer" ? "items-start" : "items-end"
                }`}
              >
                <div
                  className={`max-w-md rounded-2xl p-4 text-xs whitespace-pre-line shadow-sm ${
                    msg.sender === "customer"
                      ? "bg-[--color-bg] border border-[--color-border] text-[--color-fg]"
                      : "bg-[--color-brand] text-white"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold mb-1 opacity-80 text-[10px]">
                    {msg.sender === "customer" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span>{msg.sender === "customer" ? "Customer" : "DevsFleet AI Agent"}</span>
                    <span>· {msg.time}</span>
                  </div>
                  <p>{msg.text}</p>

                  {msg.action && (
                    <div className="mt-3 rounded-lg bg-black/15 p-2.5 text-[11px] font-mono border border-white/10">
                      <div className="flex items-center gap-1 font-semibold text-white/90">
                        <FileText className="h-3.5 w-3.5" />
                        <span>System Action Executed:</span>
                      </div>
                      <p className="mt-0.5 text-white/80">{msg.action.summary}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Input Box for Staff Takeover */}
          <div className="flex items-center gap-2 border-t border-[--color-border] pt-4">
            <input
              type="text"
              placeholder="Take over conversation or type manual response..."
              className="flex-1 rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
            />
            <button className="flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer">
              <Send className="h-3.5 w-3.5" />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
