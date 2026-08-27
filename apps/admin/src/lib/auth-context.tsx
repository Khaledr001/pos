"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthTokens } from "@devsfleet/shared-types";
import {
  api,
  clearSession,
  login as apiLogin,
  setSessionExpiredCallback,
  setTokensUpdatedCallback,
  getTokenExpiresAt,
  PROACTIVE_REFRESH_LEAD,
  refreshAccessToken,
} from "./api-client";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  roleName: string;
  permissions: string[];
  tenantId: string;
  tenantName: string;
  branchId: string | null;
  branchName: string | null;
  isPlatformAdmin?: boolean;
  /**
   * Set when a platform operator is signed in as this user. Comes from the
   * server on the impersonate response, not from anything the client decides.
   */
  impersonatedBy?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isImpersonating: boolean;
  login: (email: string, pass: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
  impersonateTenant: (tenantId: string, reason: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "devsfleet_auth_tokens";
const USER_KEY = "devsfleet_auth_user";

/**
 * There is deliberately no super-admin session backup in localStorage.
 *
 * Impersonation used to stash the operator's whole session — including a
 * live, full-length refresh token — under `devsfleet_superadmin_backup`, then
 * restore it on exit. That put a cross-tenant credential in browser storage
 * for the entire time the operator was browsing tenant-controlled content, and
 * `clearSession()` did not remove it, so a mid-session 401 stranded it there
 * indefinitely on a shared machine.
 *
 * The server hands the operator's session back instead:
 * `POST /admin/impersonation/end` authenticates with the impersonation token's
 * own signed `impersonatedBy` claim and mints a fresh operator session. The
 * client stores one session at a time and nothing it cannot afford to lose.
 */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    try {
      const storedTokens = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedTokens && storedUser) {
        const profile = JSON.parse(storedUser) as UserProfile;
        setTokens(JSON.parse(storedTokens));
        setUser(profile);
        // Derived from the profile the server returned, not from the mere
        // presence of a sentinel key — which any non-empty string used to
        // satisfy, showing the banner to anyone who set it in devtools.
        setIsImpersonating(Boolean(profile.impersonatedBy));
      }
      // Left over from the previous impersonation design. Removing it here
      // means one page load clears the stale credential rather than leaving
      // it until someone happens to log in again.
      localStorage.removeItem("devsfleet_superadmin_backup");
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Wire up the session callbacks once on mount.
   */
  useEffect(() => {
    setSessionExpiredCallback(() => {
      setUser(null);
      setTokens(null);
      setIsImpersonating(false);
    });
    setTokensUpdatedCallback((newTokens) => {
      setTokens(newTokens);
    });
  }, []);

  /**
   * Proactive token refresh timer.
   */
  useEffect(() => {
    if (!tokens?.refreshToken || !user) return;

    const checkAndRefreshToken = async () => {
      const expiresAt = getTokenExpiresAt();
      if (!expiresAt) return;

      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= PROACTIVE_REFRESH_LEAD) {
        const fresh = await refreshAccessToken();
        if (!fresh && remainingMs <= 0) {
          logout();
        }
      }
    };

    checkAndRefreshToken();
    const interval = setInterval(checkAndRefreshToken, 30_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkAndRefreshToken();
      }
    };
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [tokens?.refreshToken, user]);

  const login = async (email: string, pass: string, tenantSlug?: string) => {
    setIsLoading(true);
    try {
      const res = await apiLogin(email, pass, tenantSlug);
      const tokenPair = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresIn: res.expiresIn,
      };
      setTokens(tokenPair);

      const withExpiry = {
        ...tokenPair,
        expiresAt: Date.now() + (res.expiresIn ?? 900) * 1000,
      };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(withExpiry));

      if (res.user) {
        const profile: UserProfile = {
          id: res.user.id,
          name: res.user.name || email.split("@")[0] || "User",
          email: res.user.email || email,
          roleName: res.user.roleName || "User",
          permissions: (res.user.permissions as string[]) || [],
          tenantId: res.user.tenantId,
          tenantName: res.user.tenantName,
          branchId: res.user.branchId,
          branchName: res.user.branchName,
          isPlatformAdmin: res.user.isPlatformAdmin,
        };
        setUser(profile);
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
      }
      setIsImpersonating(false);
      // Belt and braces against the retired impersonation backup: a fresh
      // login should never inherit anything from a previous session.
      localStorage.removeItem("devsfleet_superadmin_backup");
    } finally {
      setIsLoading(false);
    }
  };

  /** Shape returned by both the impersonate and end-impersonation routes. */
  interface SessionResponse {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    user: {
      id: string;
      name: string;
      email: string;
      roleName: string;
      permissions: string[];
      tenantId: string;
      tenantName: string;
      branchId: string | null;
      branchName: string | null;
      isPlatformAdmin?: boolean;
    };
  }

  /** Swap the stored session for a freshly issued one. */
  const adoptSession = (res: SessionResponse, impersonatedBy?: string) => {
    const tokenPair: AuthTokens = {
      accessToken: res.accessToken,
      ...(res.refreshToken ? { refreshToken: res.refreshToken } : {}),
      expiresIn: res.expiresIn,
    };
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({
        ...tokenPair,
        expiresAt: Date.now() + (res.expiresIn ?? 900) * 1000,
      }),
    );
    setTokens(tokenPair);

    const profile: UserProfile = {
      id: res.user.id,
      name: res.user.name,
      email: res.user.email,
      roleName: res.user.roleName,
      permissions: res.user.permissions || [],
      tenantId: res.user.tenantId,
      tenantName: res.user.tenantName,
      branchId: res.user.branchId,
      branchName: res.user.branchName,
      isPlatformAdmin: res.user.isPlatformAdmin ?? false,
      ...(impersonatedBy ? { impersonatedBy } : {}),
    };
    setUser(profile);
    localStorage.setItem(USER_KEY, JSON.stringify(profile));
    setIsImpersonating(Boolean(impersonatedBy));
  };

  const impersonateTenant = async (tenantId: string, reason: string) => {
    if (!tokens || !user) return;
    setIsLoading(true);

    try {
      // Nothing is stashed before the call. The operator's own session is
      // reissued by the server on exit, so there is nothing to back up and
      // nothing to roll back if this fails.
      const res = await api.post<SessionResponse>(
        `/admin/tenants/${tenantId}/impersonate`,
        { reason },
      );
      adoptSession(res, user.id);
      window.location.href = "/";
    } finally {
      setIsLoading(false);
    }
  };

  const exitImpersonation = async () => {
    setIsLoading(true);
    try {
      const res = await api.post<SessionResponse>("/admin/impersonation/end", {});
      adoptSession(res);
      window.location.href = "/platform/tenants";
    } catch (err) {
      /**
       * The impersonation token is the only thing that can end its own
       * session, so if this fails there is nothing left to retry with —
       * usually it expired, which is exactly what is supposed to happen to an
       * unrefreshable session. Sign out rather than strand the operator in a
       * tenant they can no longer leave.
       */
      console.error("Could not end impersonation cleanly:", err);
      await logout();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    const currentTokens = tokens;
    if (currentTokens?.refreshToken) {
      try {
        await api.post("/auth/logout", { refreshToken: currentTokens.refreshToken });
      } catch (err) {
        console.warn("Could not notify backend of logout:", err);
      }
    }
    setTokens(null);
    setUser(null);
    setIsImpersonating(false);
    clearSession();

    if (typeof window !== "undefined") window.location.href = "/login";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isLoading,
        isImpersonating,
        login,
        logout,
        impersonateTenant,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
