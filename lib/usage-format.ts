/**
 * Shared formatters for Usage & Analytics Dashboard, matching native omp dashboard conventions.
 */

export function formatTokenCount(tokens: number, locale = "zh"): string {
  if (!Number.isFinite(tokens) || tokens === 0) return "0";

  if (locale.startsWith("zh")) {
    if (Math.abs(tokens) >= 100_000_000) {
      return `${(tokens / 100_000_000).toFixed(2)}亿`;
    }
    if (Math.abs(tokens) >= 10_000) {
      return `${(tokens / 10_000).toFixed(1)}万`;
    }
    return tokens.toLocaleString();
  }

  if (Math.abs(tokens) >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(tokens) >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(tokens) >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

export function formatCostUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost === 0) return "$0.00";
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  if (ms >= 60_000) {
    const mins = Math.floor(ms / 60_000);
    const secs = Math.round((ms % 60_000) / 1000);
    return `${mins}m ${secs}s`;
  }
  if (ms >= 10_000) {
    return `${Math.round(ms)}ms`;
  }
  return `${Math.round(ms)}ms`;
}

export function formatTokensPerSecond(tps: number | null | undefined): string {
  if (tps === null || tps === undefined || !Number.isFinite(tps) || tps <= 0) return "-";
  return `${tps.toFixed(1)}`;
}

export function formatTimestampFull(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "-";
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  const second = String(d.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

export function formatResetTime(resetAt: number): string {
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) return "已重置 (Ready)";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins} 分钟后重置`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}小时${remMins > 0 ? ` ${remMins}分钟` : ""}后重置`;
  const days = Math.floor(hours / 24);
  return `${days} 天后重置`;
}
