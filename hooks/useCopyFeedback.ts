"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

/** Copy-to-clipboard with a transient "copied" feedback flag (1500 ms).
 * Shared by the copy buttons in MessageView / MermaidBlock etc. — each
 * previously inlined the same state + timer dance. */
export function useCopyFeedback(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    copyText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Clipboard denied (permissions, unfocused document): stay silent —
      // the button just never flips to "copied".
    });
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { copied, copy };
}
