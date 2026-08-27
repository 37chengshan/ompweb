"use client";

import { Sparkles, TerminalSquare, Compass, ShieldCheck, FileCode2, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  onSelectPrompt: (prompt: string) => void;
  cwd?: string | null;
}

export function EmptyChatHero({ onSelectPrompt, cwd }: Props) {
  const { t } = useI18n();

  const promptCards = [
    {
      icon: Compass,
      title: t("emptyState.cardPlanTitle") || "智能工程规划",
      desc: t("emptyState.cardPlanDesc") || "分析当前项目结构，自动分解任务并生成实施路线",
      prompt: "/plan 分析当前项目的架构与核心模块，并制定下一步计划",
      accent: "var(--accent)",
    },
    {
      icon: ShieldCheck,
      title: t("emptyState.cardReviewTitle") || "代码质量审查",
      desc: t("emptyState.cardReviewDesc") || "多维度审查最近的代码改动、类型安全与潜在隐患",
      prompt: "/review 审查最近的代码改动，排查逻辑缺陷与规范问题",
      accent: "#38BDF8",
    },
    {
      icon: TerminalSquare,
      title: t("emptyState.cardTestTitle") || "运行测试与验证",
      desc: t("emptyState.cardTestDesc") || "执行项目测试套件，自动捕获错误并提供修复方案",
      prompt: "/test 运行测试套件并验证系统功能完整性",
      accent: "#4ADE80",
    },
    {
      icon: FileCode2,
      title: t("emptyState.cardExploreTitle") || "工作区检索与答疑",
      desc: t("emptyState.cardExploreDesc") || "向 omp 提问，输入 @ 快速引用文件或函数进行研讨",
      prompt: "简要介绍当前工作区的主要功能与目录结构",
      accent: "#FBBF24",
    },
  ];

  return (
    <div
      className="empty-chat-hero animate-fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px 20px",
        textAlign: "center",
        maxWidth: 720,
        margin: "0 auto",
        userSelect: "none",
      }}
    >
      {/* 艺术字标题 Typography */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 8%, var(--bg-panel))",
            border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)",
            color: "var(--accent)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 14,
            fontFamily: "var(--font-mono)",
          }}
        >
          <Sparkles size={12} strokeWidth={2.2} aria-hidden="true" />
          <span>OMP Coding Agent · Web Workspace</span>
        </div>

        <h1
          className="display-serif"
          style={{
            fontSize: "clamp(36px, 5.5vw, 54px)",
            lineHeight: 1.1,
            margin: "0 0 10px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "var(--text)",
            textShadow: "0 2px 12px color-mix(in srgb, var(--accent) 15%, transparent)",
          }}
        >
          omp<span style={{ color: "var(--accent)", fontStyle: "italic", marginLeft: 2 }}>web</span>
        </h1>

        <p
          style={{
            fontSize: "clamp(13px, 2vw, 15px)",
            color: "var(--text-muted)",
            margin: "0 auto",
            maxWidth: 480,
            lineHeight: 1.6,
          }}
        >
          {t("emptyState.subtitle") || "代码中枢 · 沉浸式多模型协同与智能会话流转"}
        </p>
      </div>

      {/* 快捷 Prompt 卡片 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
          width: "100%",
          marginTop: 18,
          marginBottom: 16,
          textAlign: "left",
        }}
      >
        {promptCards.map((card, idx) => {
          const IconComponent = card.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectPrompt(card.prompt)}
              className="group ui-focus-ring"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                borderRadius: "var(--radius-card)",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out-warm)",
                boxShadow: "var(--shadow-card)",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 50%, var(--border))";
                e.currentTarget.style.boxShadow = "var(--shadow-pop)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "var(--shadow-card)";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: "var(--bg-hover)",
                      color: card.accent,
                    }}
                  >
                    <IconComponent size={15} strokeWidth={2} />
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{card.title}</span>
                </div>
                <ArrowRight
                  size={13}
                  strokeWidth={2}
                  style={{
                    color: "var(--text-dim)",
                    opacity: 0.6,
                    transition: "transform var(--dur-fast)",
                  }}
                />
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
                {card.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* 底部快捷键提示 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontSize: 11,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>
          输入 <kbd style={{ padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>/</kbd> 指令
        </span>
        <span>·</span>
        <span>
          使用 <kbd style={{ padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>@</kbd> 引用文件
        </span>
        <span>·</span>
        <span>
          <kbd style={{ padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>⌘K</kbd> 命令面板
        </span>
      </div>
    </div>
  );
}
