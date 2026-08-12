import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };

// Function form: `phase` is authoritative even when the host environment
// carries a stray NODE_ENV (e.g. NODE_ENV=production inherited by `next dev`
// processes). Relying on process.env.NODE_ENV here would apply the immutable
// chunk rule in development, make the browser cache dev chunks forever, and
// produce stale "module factory is not available" / hydration errors after
// every restart.
const nextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    // Keep standalone/server tracing inside this package. Without this explicit
    // root, Next can choose a parent lockfile on Windows and traverse protected
    // user-profile junctions while compiling.
    outputFileTracingRoot: process.cwd(),
    serverExternalPackages: ["undici"],
    webpack(config: Parameters<NonNullable<NextConfig["webpack"]>>[0]) {
      // Next's entrypoint tracer does not automatically reject dynamic paths
      // outside the project root. Add parent/profile patterns to its ignore list
      // so user filesystem discovery remains request-time only during builds.
      for (const plugin of config.plugins ?? []) {
        const candidate = plugin as unknown as {
          constructor?: { name?: string };
          traceIgnores?: string[];
        };
        if (candidate.constructor?.name === "TraceEntryPointsPlugin") {
          candidate.traceIgnores ??= [];
          candidate.traceIgnores.push("**/../**", "**/Users/**", "**/Application Data/**");
        }
      }
      return config;
    },
    allowedDevOrigins: ['192.168.*.*'],
    // Security: stop advertising the runtime, and surface dev-mode problems
    // earlier. Source maps in the browser bundle leak server path layout and
    // bloat downloads without helping end users of a published app.
    poweredByHeader: false,
    reactStrictMode: true,
    productionBrowserSourceMaps: false,
    // Next.js enables gzip/brotli compression for `next start` by default; no
    // custom compression middleware is needed (and would require a custom server).
    async headers() {
      const headers = [
        {
          // Hashed build output never changes, so browsers/proxies may cache it
          // immutably for a year and skip revalidation entirely.
          // NOTE: scoped to /_next/static/ only — broader /_next/ patterns would
          // shadow the HMR WebSocket in development.
          source: "/_next/static/:path*",
          headers: [
            { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ],
        },
        {
          source: "/",
          headers: [
            { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
          ],
        },
      ];

      // Dev chunks have stable URLs whose content changes in place; caching
      // them immutably would serve stale module factories after a restart.
      if (isDev) return headers.slice(1);

      return headers;
    },
    env: {
      NEXT_PUBLIC_APP_VERSION: version,
      NEXT_PUBLIC_OMP_WEB_VERSION: version,
    },
  };
};

export default nextConfig;
