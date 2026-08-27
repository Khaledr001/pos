"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import type { NotificationSeverity, NotificationType } from "@devsfleet/shared-types";
import { api } from "./api-client";
import { useAuth } from "./auth-context";
import { connectNotificationSocket } from "./notification-socket";

export interface AppNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  referenceType: string | null;
  referenceId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

interface UnreadCount {
  total: number;
  byType: Record<string, number>;
}

const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;
const LIST_KEY = ["notifications", "list"] as const;

/**
 * The badge's only dependency.
 *
 * Polled every 60s regardless of the socket, since the socket is an
 * accelerator and not something this can afford to depend on — a proxy with
 * no WebSocket upgrade path must not leave the badge permanently stale.
 * `refetchOnWindowFocus` is turned back on here: the app-wide default in
 * providers.tsx turns it off, correctly, for data that does not go stale by
 * itself — this does.
 */
export function useUnreadCount() {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => api.get<UnreadCount>("/notifications/unread-count"),
    enabled: Boolean(tokens?.accessToken),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The panel's list. Fetched when it opens, not kept warm while closed. */
export function useNotificationsList(open: boolean) {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api.get<AppNotification[]>("/notifications", { query: { limit: 20 } }),
    enabled: Boolean(tokens?.accessToken) && open,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>("/notifications/read-all", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/**
 * Keeps a socket connected while signed in and invalidates the two queries
 * above whenever a notification arrives, so an open tab sees it without
 * waiting for the next poll. The socket carries no state of its own — on
 * "notification" it does not merge the pushed row into the cache, it just
 * asks for a refetch, which is what keeps the REST endpoints the single
 * source of truth.
 */
export function useNotificationSocket(): void {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = tokens?.accessToken;
    if (!token) return;

    let socket: Socket | null = connectNotificationSocket(token);

    const onNotification = () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    };
    socket.on("notification", onNotification);

    return () => {
      socket?.off("notification", onNotification);
      socket?.disconnect();
      socket = null;
    };
  }, [tokens?.accessToken, queryClient]);
}
