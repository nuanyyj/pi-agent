"use client";

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";

interface AuthState {
  mode: string;
  disabled: boolean;
  authenticated: boolean;
  token: string | null;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  setToken: (token: string) => void;
  logout: () => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_STORAGE_KEY = "pi-enterprise-auth-token";

export function EnterpriseAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    mode: "token",
    disabled: true,
    authenticated: false,
    token: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);

  // Load stored token and validate
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    checkAuth(stored);
  }, []);

  const checkAuth = useCallback(async (token: string | null) => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/enterprise/v1/auth", { headers });
      const data = (await res.json()) as {
        mode: string;
        disabled: boolean;
        authenticated: boolean;
        error?: string;
      };

      setState({
        mode: data.mode,
        disabled: data.disabled,
        authenticated: data.authenticated,
        token: data.authenticated ? token : null,
        error: data.error ?? null,
      });

      if (data.authenticated && token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      }
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to check auth status" }));
    } finally {
      setLoading(false);
    }
  }, []);

  const setToken = useCallback((token: string) => {
    checkAuth(token);
  }, [checkAuth]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setState({
      mode: "token",
      disabled: true,
      authenticated: false,
      token: null,
      error: null,
    });
  }, []);

  const fetchWithAuth = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (state.token) {
      headers.set("Authorization", `Bearer ${state.token}`);
    }
    return fetch(url, { ...init, headers });
  }, [state.token]);

  // Show loading spinner while checking
  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "var(--text-muted)", fontSize: 14,
      }}>
        Checking authentication...
      </div>
    );
  }

  // Show login form if auth is required but not authenticated
  if (!state.disabled && !state.authenticated) {
    return (
      <EnterpriseLoginForm
        mode={state.mode}
        error={state.error}
        onSubmit={setToken}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ ...state, setToken, logout, fetchWithAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useEnterpriseAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useEnterpriseAuth must be used within EnterpriseAuthProvider");
  return ctx;
}

// ── Login form ────────────────────────────────────────────────────────

function EnterpriseLoginForm({ mode, error, onSubmit }: { mode: string; error: string | null; onSubmit: (token: string) => void }) {
  const [token, setToken] = useState("");

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--bg)",
    }}>
      <div style={{
        width: 360, padding: 32,
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 12,
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>
            Enterprise Login
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            {mode === "oidc" ? "SSO authentication required" : "API token required"}
          </div>
        </div>

        {error && (
          <div style={{
            padding: "8px 12px", marginBottom: 16,
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 6, fontSize: 12, color: "#f87171",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); onSubmit(token); }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            {mode === "oidc" ? "Access Token" : "API Token"}
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your token..."
            autoFocus
            style={{
              width: "100%", height: 40, fontSize: 13,
              background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: "0 12px", marginBottom: 16,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!token.trim()}
            style={{
              width: "100%", height: 40, fontSize: 13, fontWeight: 600,
              background: token.trim() ? "var(--accent)" : "var(--border)",
              color: "#fff", border: "none", borderRadius: 6,
              cursor: token.trim() ? "pointer" : "default",
            }}
          >
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}
