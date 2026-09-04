import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRouteBoundary } from "../scripts/audit-backend-ownership.mjs";

// Route 2 (doc 16): production API routes must reach domain authorities only
// through HostClient/lib boundaries — never by constructing RpcProcess /
// node-pty etc. directly. The one current exception (auth login interactive
// stream) is allowlisted with its pending route.

test("route boundary: no production route constructs OMP or PTY authorities directly", () => {
  const result = auditRouteBoundary();
  // Allowlisted findings (auth login, pending route 4) are informational.
  const hard = result.problems.filter((p) => !p.startsWith("(allowlisted)"));
  assert.deepEqual(hard, [], hard.join("; "));
});

test("route boundary: a route that constructs RpcProcess fails the gate", (t) => {
  const tree = mkdtempSync(join(tmpdir(), "route-boundary-"));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  mkdirSync(join(tree, "app", "api", "evil"), { recursive: true });
  writeFileSync(
    join(tree, "app", "api", "evil", "route.ts"),
    'export function GET() { const p = new RpcProcess({ cwd: "/" }); return p; }\n',
  );
  const result = auditRouteBoundary({ productionRoot: tree });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("evil/route.ts") && p.includes("new RpcProcess(")));
});

test("route boundary: allowlisted files report informational findings, not failures", (t) => {
  const tree = mkdtempSync(join(tmpdir(), "route-boundary-ok-"));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const dir = join(tree, "app", "api", "auth", "login", "[provider]");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "route.ts"), "const p = new RpcProcess({});\n");
  const result = auditRouteBoundary({ productionRoot: tree });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.ok(result.problems.every((p) => p.startsWith("(allowlisted)")));
});
