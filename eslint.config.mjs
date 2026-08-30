import fs from "node:fs";
import path from "node:path";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// 5.0 plan W0 gate (docs/refactor/ompweb-5.0/01 Slice 1): new UI code must go
// through lib/client adapters instead of calling /api routes or opening
// EventSource connections directly. Legacy call sites live in the generated
// allowlist and shrink over time; counts are enforced by lib/api-inventory.test.mjs.
const allowlistPath = path.join(import.meta.dirname, "scripts", "client-api-allowlist.json");
const allowedFiles = new Set(
  Object.keys(
    // A missing/corrupt allowlist must not take down lint entirely; with an
    // empty set every legacy file starts erroring, which is the loud default.
    JSON.parse(fs.readFileSync(allowlistPath, "utf8").trim() || "{}").files ?? {},
  ),
);

function startsWithApi(value) {
  return typeof value === "string" && value.trimStart().startsWith("/api");
}

const isFetchCallee = (callee) =>
  (callee.type === "Identifier" && callee.name === "fetch") ||
  (callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "fetch");

const noDirectClientApi = {
  meta: {
    type: "problem",
    docs: { description: "Require /api access and SSE to go through lib/client adapters" },
    schema: [],
    messages: {
      directApi:
        "Direct /api call in UI code — use the lib/client adapters (5.0 plan doc 01). " +
        "To register a legacy call site, run: node scripts/audit-client-api.mjs --update-allowlist",
    },
  },
  create(context) {
    const file = path.relative(import.meta.dirname, context.filename).replaceAll(path.sep, "/");
    if (allowedFiles.has(file)) return {};
    const report = (node) => context.report({ node, messageId: "directApi" });
    return {
      CallExpression(node) {
        if (!isFetchCallee(node.callee)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (arg.type === "Literal" && startsWithApi(arg.value)) return report(node);
        // Any template segment starting with /api counts — catches `${base}/api/x`
        // dynamic-prefix bypasses as well as direct `/api/...` templates.
        if (
          arg.type === "TemplateLiteral" &&
          arg.quasis.some((quasi) => startsWithApi(quasi.value.cooked))
        )
          return report(node);
        if (
          arg.type === "CallExpression" &&
          arg.callee.type === "Identifier" &&
          /ApiUrl$/.test(arg.callee.name)
        )
          return report(node);
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "EventSource") report(node);
      },
    };
  },
};

const eslintConfig = [
  {
    ignores: ["dist-desktop/**", "**/standalone/**", "**/app.asar.unpacked/**"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Electron main/preload run in Node CJS (no TS, no ESM): the require-import
  // rule does not apply there.
  {
    files: ["desktop/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    plugins: {
      "ompweb-client-boundary": { rules: { "no-direct-client-api": noDirectClientApi } },
    },
    rules: {
      "ompweb-client-boundary/no-direct-client-api": "error",
    },
  },
];

export default eslintConfig;
