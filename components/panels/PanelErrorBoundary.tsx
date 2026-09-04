"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface PanelErrorBoundaryProps {
  title: string;
  unavailable: string;
  retryLabel: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

/** Prevent a single viewer/plugin failure from blanking the whole workspace.
 * The retry stays local to the panel so the conversation, terminal and other
 * panel tabs remain usable while the failed subtree is remounted. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ompweb] ${this.props.title} render failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, color: "var(--text-muted)", textAlign: "center", fontSize: 12 }}>
        <strong style={{ color: "var(--text)" }}>{this.props.title} {this.props.unavailable}</strong>
        <span style={{ maxWidth: 320, overflowWrap: "anywhere", color: "var(--text-dim)" }}>{this.state.error.message}</span>
        <button type="button" onClick={() => this.setState({ error: null })} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer" }}>
          <RefreshCw size={13} aria-hidden="true" />{this.props.retryLabel}
        </button>
      </div>
    );
  }
}
