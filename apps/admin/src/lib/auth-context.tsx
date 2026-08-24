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
}

interface AuthContextType {
  user: UserProfile | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  login: (email: string, pass: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "devsfleet_auth_tokens";
const USER_KEY = "devsfleet_auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedTokens = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedTokens && storedUser) {
        setTokens(JSON.parse(storedTokens));
        setUser(JSON.parse(storedUser));
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Wire up the session callbacks once on mount.
   *
   * 1. sessionExpired: Clears React state when token refresh fails before navigation.
   * 2. tokensUpdated: Keeps React state in sync when background/reactive refresh succeeds.
   */
  useEffect(() => {
    setSessionExpiredCallback(() => {
      setUser(null);
      setTokens(null);
    });
    setTokensUpdatedCallback((newTokens) => {
      setTokens(newTokens);
    });
  }, []);

  /**
   * Proactive token refresh timer.
   *
   * Rather than waiting for a request to fail with a 401, we proactively refresh
   * the access token ~2 minutes before it expires. This ensures active users never
   * experience auth hiccups, lag, or dropped queries.
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
          // Access token is expired and refresh token is invalid/revoked
          logout();
        }
      }
    };

    // Run check on mount / token change
    checkAndRefreshToken();

    // Check periodically every 30 seconds
    const interval = setInterval(checkAndRefreshToken, 30_000);

    // Also check when tab becomes active after backgrounding
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
        };
        setUser(profile);
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
      }
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
        // Revoking server-side is best effort; the local session goes either
        // way. Leaving it behind because the network blinked would be the
        // worse of the two failures.
        console.warn("Could not notify backend of logout:", err);
      }
    }
    setTokens(null);
    setUser(null);
    clearSession();

    /**
     * A full navigation, not `router.push`.
     *
     * Signing out has to discard the React tree as well as the tokens: a
     * client-side transition keeps every page's cached state in memory, so the
     * next person at the same machine can still read the previous user's
     * customer list out of a component that never unmounted.
     */
    if (typeof window !== "undefined") window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, tokens, isLoading, login, logout }}>
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
