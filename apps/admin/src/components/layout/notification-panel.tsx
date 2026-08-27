"use client";

import React from "react";
import {
  Bell,
  Boxes,
  CheckCheck,
  ClipboardList,
  Inbox,
  Info,
  Loader2,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import type { NotificationSeverity, NotificationType } from "@devsfleet/shared-types";
import { timeAgo } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useNotificationSocket,
  useUnreadCount,
  type AppNotification,
} from "@/lib/use-notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  low_stock: Boxes,
  due_reminder: Wallet,
  sale: ShoppingCart,
  order: ClipboardList,
  system: Info,
};

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  info: "bg-primary",
  warning: "bg-amber-500",
  critical: "bg-destructive",
};

function NotificationRow({ notification }: { notification: AppNotification }) {
  const markRead = useMarkNotificationRead();
  const Icon = TYPE_ICON[notification.type] ?? Info;

  return (
    <button
      type="button"
      onClick={() => {
        if (!notification.isRead) markRead.mutate(notification.id);
      }}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:bg-muted/60",
        !notification.isRead && "bg-primary/5",
      )}
    >
      <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-popover",
            SEVERITY_DOT[notification.severity],
          )}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={cn(
            "truncate text-xs",
            notification.isRead ? "font-medium text-muted-foreground" : "font-semibold text-foreground",
          )}
        >
          {notification.title}
        </p>
        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {notification.message}
        </p>
        <p className="text-[10px] text-muted-foreground/70">{timeAgo(notification.createdAt)}</p>
      </div>
      {!notification.isRead && (
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      )}
    </button>
  );
}

export function NotificationPanel() {
  const [open, setOpen] = React.useState(false);
  const { data: unread } = useUnreadCount();
  const { data: notifications, isLoading } = useNotificationsList(open);
  const markAllRead = useMarkAllNotificationsRead();
  useNotificationSocket();

  const total = unread?.total ?? 0;
  const badgeLabel = total > 99 ? "99+" : String(total);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
          aria-label={total > 0 ? `Notifications, ${total} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {total > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full gradient-brand px-1 text-[9px] font-bold text-white ring-2 ring-background">
              {badgeLabel}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2 shadow-xl rounded-xl border border-border">
        <div className="flex items-center justify-between px-1 py-1">
          <span className="text-xs font-semibold text-foreground">Notifications</span>
          {total > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="my-1" />

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground/70">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <ScrollArea className="h-[min(60vh,420px)]">
            <div className="space-y-0.5 pr-2">
              {notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))}
            </div>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
