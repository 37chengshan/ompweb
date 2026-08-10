"use client";

import { SyntaxHighlighter, vs, vscDarkPlus } from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  code: string;
  lang: string;
}

export function SyntaxHighlightedCode({ code, lang }: Props) {
  const { isDark } = useTheme();

  return (
    <SyntaxHighlighter
      language={lang || "text"}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
      customStyle={{
        margin: 0,
        padding: "11px 13px",
        fontSize: 12.5,
        lineHeight: 1.62,
        borderRadius: 0,
        background: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
      }}
      codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
