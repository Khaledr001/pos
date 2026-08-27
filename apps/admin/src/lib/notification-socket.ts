import { io, type Socket } from "socket.io-client";
import { getApiOrigin } from "./api-client";

/**
 * Opens a connection to NotificationsGateway's `/notifications` namespace.
 *
 * An accelerator, not the source of truth — see useNotificationSocket in
 * use-notifications.ts, which is the only caller. If this never connects (a
 * proxy with no WebSocket upgrade path, a token that went stale) the panel
 * still works off the REST endpoints and the badge's own poll.
 */
export function connectNotificationSocket(accessToken: string): Socket {
  return io(`${getApiOrigin()}/notifications`, {
    transports: ["websocket"],
    auth: { token: accessToken },
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
}
