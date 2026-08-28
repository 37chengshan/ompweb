"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Play, MessageSquareWarning, ListTree } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMarkdownPlugins } from "@/lib/markdown";

interface Props {
  sessionId: string;
  /** Fill the composer with the execute/reject prompt (user presses Enter). */
  onComposerPrompt?: (text: string) => void;
}

interface Heading {
  id: string;
  level: number;
  text: string;
}

function parseHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  const re = /^(#{1,4})\s+(.+?)\s*#*\s*$/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(markdown)) !== null) {
    out.push({ id: `plan-heading-${index++}`, level: match[1].length, text: match[2].trim() });
  }
  return out;
}

/**
 * Plan document viewer for the right sidebar panel. Renders the omp plan
 * markdown full-height with a sticky table-of-contents (click to jump) and
 * execute/reject actions — no task grid (that lives in the composer panels).
 */
export function PlanViewer({ sessionId, onComposerPrompt }: Props) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(plan ?? "");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/plan`)
      .then((res) => (res.ok ? res.json() as Promise<{ plan?: string | null }> : null))
      .then((data) => {
        if (!cancelled) {
          setPlan(typeof data?.plan === "string" ? data.plan : null);
          setError(null);
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [sessionId]);

  const headings = useMemo(() => (plan ? parseHeadings(plan) : []), [plan]);

  const scrollToHeading = useCallback((id: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-plan-heading="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveHeading(id);
  }, []);

  // Track which heading is at the top for TOC highlighting.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length === 0) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let current: string | null = null;
        for (const h of headings) {
          const el = container.querySelector<HTMLElement>(`[data-plan-heading="${h.id}"]`);
          if (el && el.getBoundingClientRect().top <= container.getBoundingClientRect().top + 8) {
            current = h.id;
          }
        }
        setActiveHeading(current);
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [headings]);

  // Attach TOC anchor ids to the rendered headings (react-markdown cannot
  // inject them directly, so we zip the parsed headings with the DOM order).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length === 0) return;
    const els = container.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
    headings.forEach((h, i) => {
      if (els[i]) els[i].setAttribute("data-plan-heading", h.id);
    });
  }, [headings, plan]);

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--status-error)" }}>
        {t("planViewer.loadFailed")}: {error}
      </div>
    );
  }

  if (plan === null) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        {t("planViewer.loading")}
      </div>
    );
  }

  if (plan.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        {t("planViewer.noPlan")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Toolbar: execute / revise */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("plan.modeTitle") || "OMP Plan"}
        </span>
        <button
          type="button"
          onClick={() => onComposerPrompt?.(t("planViewer.executePrompt"))}
          className="ui-focus-ring"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}
        >
          <Play size={11} strokeWidth={2.4} />
          <span>{t("plan.executeButton") || "执行此计划"}</span>
        </button>
        <button
          type="button"
          onClick={() => onComposerPrompt?.(t("planViewer.rejectPrompt"))}
          className="ui-focus-ring"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--status-warning)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          <MessageSquareWarning size={11} strokeWidth={2} />
          <span>{t("plan.rejectButton") || "打回修改"}</span>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Table of contents */}
        {headings.length > 0 && (
          <div style={{ flexShrink: 0, width: 170, overflowY: "auto", borderRight: "1px solid var(--border)", padding: "8px 6px", background: "var(--bg-panel)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 6px 6px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-mono)" }}>
              <ListTree size={11} aria-hidden="true" />
              <span>{t("planViewer.toc")}</span>
            </div>
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => scrollToHeading(h.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "3px 6px",
                  paddingLeft: 6 + (h.level - 1) * 10,
                  border: "none",
                  borderRadius: 5,
                  background: activeHeading === h.id ? "var(--bg-selected)" : "transparent",
                  color: activeHeading === h.id ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11,
                  lineHeight: 1.35,
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={h.text}
              >
                {h.text}
              </button>
            ))}
          </div>
        )}

        {/* Document */}
        <div
          ref={scrollRef}
          style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 18px" }}
        >
          <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
            >
              {plan}
            </ReactMarkdown>
          </div>
          {plan && plan.length === 0 && (
            <div style={{ padding: "10px 4px", fontSize: 12, color: "var(--text-dim)" }}>
              {t("planViewer.noPlan")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}