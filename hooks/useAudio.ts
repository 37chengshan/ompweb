"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
    // Connected WebAudio nodes are not garbage-collected; detach them once the
    // tone finishes so each completion sound does not leak 4 graph nodes.
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  });
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("omp-sound-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // The settings dialog toggles the same preference; keep the live state in
  // sync when it changes there.
  useEffect(() => {
    const onPrefChange = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      if (typeof detail !== "boolean") return;
      enabledRef.current = detail;
      setEnabled(detail);
    };
    window.addEventListener("omp-sound-pref-change", onPrefChange);
    return () => window.removeEventListener("omp-sound-pref-change", onPrefChange);
  }, []);

  // Reuse a single AudioContext so it can be resumed if the browser
  // autoplay policy suspends it (contexts created outside user gestures
  // start in "suspended" state and produce no sound).
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().catch(() => {});
  }, [getCtx]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    enabledRef.current = next;
    localStorage.setItem("omp-sound-enabled", String(next));
    setEnabled(next);
  }, [unlockAudio]);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const play = () => {
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, [getCtx]);

  return { soundEnabled: enabled, onSoundToggle: toggle, playDoneSound: playDone, unlockAudio, soundEnabledRef: enabledRef };
}
