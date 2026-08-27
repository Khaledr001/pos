import type { Notification } from "@devsfleet/db";
import type { JwtPayload } from "@devsfleet/shared-types";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { Env } from "../../config/env.js";

function roomFor(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

/**
 * An accelerator, not the source of truth.
 *
 * The admin panel fetches its list and unread count over plain REST whenever
 * it opens; this only pushes an invalidation so an open tab does not have to
 * poll for one. If a socket never connects — a proxy with no upgrade path
 * configured, a corporate network, a token that went stale mid-session — the
 * panel still works, just without the live nudge. Build and prove the REST
 * path first; this is additive.
 *
 * Auth is the handshake token, verified with the same secret JwtAuthGuard
 * uses. Per D12, access tokens are not checked against the database, so this
 * stays a pure signature-and-expiry check — no extra query on connect.
 */
@WebSocketGateway({
  namespace: "/notifications",
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      this.reject(socket, "No access token on the handshake");
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      });
      if (!payload.sub || !payload.tenantId) {
        this.reject(socket, "Token names no tenant");
        return;
      }
      await socket.join(roomFor(payload.tenantId, payload.sub));
    } catch {
      this.reject(socket, "Invalid or expired access token");
    }
  }

  handleDisconnect(): void {
    // socket.io drops room membership on disconnect on its own.
  }

  /**
   * Called right after `NotificationsService.notify()` writes a row.
   *
   * Never awaited by the caller — a recipient with no open tab has no room to
   * deliver into, and that is a normal outcome, not a failure.
   */
  pushToUser(tenantId: string, userId: string, notification: Notification): void {
    this.server?.to(roomFor(tenantId, userId)).emit("notification", notification);
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.["token"];
    if (typeof fromAuth === "string" && fromAuth) return fromAuth;

    const header = socket.handshake.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  }

  private reject(socket: Socket, reason: string): void {
    this.logger.debug({ reason }, "Rejected a notifications socket handshake");
    socket.disconnect(true);
  }
}
