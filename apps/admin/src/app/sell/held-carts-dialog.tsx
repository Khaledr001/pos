"use client";

import React, { useEffect, useState } from "react";
import { Clock, Loader2, Pause, Play, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_HELD_CARTS, heldAgo, type HeldCart } from "@/lib/held-carts";

export type ResumeMode = "plain" | "park-current" | "discard-current";

/**
 * The parked-sales list.
 *
 * Resuming over a live cart is a two-step choice made INSIDE this dialog rather
 * than a second one stacked on top: the operator is already looking at it, and
 * a single dialog keeps focus in one place for a keyboard-only user.
 */
export function HeldCartsDialog({
  open,
  onOpenChange,
  carts,
  liveCartHasLines,
  busy,
  error,
  formatTotal,
  onResume,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carts: HeldCart[];
  liveCartHasLines: boolean;
  /** True while a resume is re-checking prices — nothing else may start. */
  busy: boolean;
  /** The page's banner is hidden behind this dialog, so a refusal is repeated here. */
  error: string | null;
  /** Formats the total snapshotted at parking time. */
  formatTotal: (cart: HeldCart) => string;
  onResume: (cart: HeldCart, mode: ResumeMode) => void;
  onDelete: (cart: HeldCart) => void;
}) {
  const [conflict, setConflict] = useState<HeldCart | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConflict(null);
      setConfirmingId(null);
    }
  }, [open]);

  // Another tab may resume or delete the cart this dialog is mid-question on.
  useEffect(() => {
    if (conflict && !carts.some((c) => c.id === conflict.id)) setConflict(null);
    if (confirmingId && !carts.some((c) => c.id === confirmingId)) setConfirmingId(null);
  }, [carts, conflict, confirmingId]);

  function choose(cart: HeldCart) {
    if (liveCartHasLines) {
      setConflict(cart);
      return;
    }
    onResume(cart, "plain");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {conflict ? "The current cart has items" : `Held carts (${carts.length})`}
          </DialogTitle>
          <DialogDescription>
            {conflict
              ? "Resuming a held cart replaces what is on the counter. Choose what happens to it."
              : `Sales parked on this browser for this branch. Up to ${MAX_HELD_CARTS} can be held; prices and stock are re-checked when you resume one.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </p>
        )}

        {conflict ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Resuming {conflict.customer?.name ?? "the walk-in cart"} ({conflict.lines.length}{" "}
              {conflict.lines.length === 1 ? "line" : "lines"}).
            </p>
            <DialogFooter className="sm:flex-col sm:space-x-0">
              <Button disabled={busy} onClick={() => onResume(conflict, "park-current")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Pause className="size-4" />}
                Hold the current cart, then resume
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onResume(conflict, "discard-current")}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Discard the current cart and resume
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConflict(null)}>
                Back to the list
              </Button>
            </DialogFooter>
          </div>
        ) : carts.length === 0 ? (
          <div className="py-8 text-center">
            <Pause className="mx-auto mb-2 size-8 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No carts on hold</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Press F8 or use Hold while building a cart to park it for later.
            </p>
          </div>
        ) : (
          <ul className="max-h-[min(24rem,55vh)] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {carts.map((cart) => {
              const confirming = confirmingId === cart.id;
              const lineWord = cart.lines.length === 1 ? "line" : "lines";
              const who = cart.customer?.name ?? "Walk-in";
              return (
                <li key={cart.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{who}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        <time dateTime={cart.heldAt} title={new Date(cart.heldAt).toLocaleString()}>
                          {heldAgo(cart.heldAt)}
                        </time>
                      </span>
                      <span>
                        {cart.lines.length} {lineWord}
                      </span>
                    </p>
                  </div>

                  <span
                    className="shrink-0 font-mono text-sm font-semibold tabular-nums"
                    title="Total when it was parked"
                  >
                    {formatTotal(cart)}
                  </span>

                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Confirm delete">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirmingId(null);
                          onDelete(cart);
                        }}
                      >
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirmingId(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => choose(cart)}
                        aria-label={`Resume held cart for ${who}, ${cart.lines.length} ${lineWord}`}
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                        Resume
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirmingId(cart.id)}
                        aria-label={`Delete held cart for ${who}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
