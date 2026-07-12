"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for enterprise components. Catches rendering errors
 * and shows a recovery UI instead of crashing the whole app.
 */
export class EnterpriseErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[enterprise] error boundary caught:", error, info);
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", padding: 32, background: "var(--bg)",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, textAlign: "center", maxWidth: 400 }}>
            {this.state.error?.message ?? "An unexpected error occurred in the enterprise module."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={this.handleRetry}
              style={{
                height: 36, padding: "0 16px", fontSize: 13, fontWeight: 500,
                background: "var(--accent)", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer",
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                height: 36, padding: "0 16px", fontSize: 13,
                background: "transparent", color: "var(--text-muted)",
                border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
