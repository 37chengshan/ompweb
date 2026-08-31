import assert from "node:assert/strict";
import test from "node:test";
import { auditManifest, loadManifest } from "../scripts/audit-backend-ownership.mjs";

// Backend Ownership Manifest gate (doc 15 / v4 PR-C02): the manifest must
// list every domain, authorities must be node|rust, evidence files must
// exist, and rust domains must not carry production Node authority markers.
test("ownership manifest: all 9 domains, valid authorities, evidence exists", () => {
  const result = auditManifest();
  assert.deepEqual(
    Object.keys(result.domains).sort(),
    ["agent", "commands", "event", "files", "git", "pty", "remote", "session", "settings"],
  );
  for (const authority of Object.values(result.domains)) {
    assert.ok(["node", "rust"].includes(authority), `authority ${authority}`);
  }
  assert.equal(result.ok, true, result.problems.join("; "));
});

test("ownership manifest: current baseline is all node (migration not started)", () => {
  const result = auditManifest();
  for (const authority of Object.values(result.domains)) {
    assert.equal(authority, "node", "baseline: every domain must still be node");
  }
});

test("ownership manifest: rust gate scan rejects node markers for rust domains", () => {
  // Simulate a drift: flip session to rust while lib/session-reader.ts (the
  // Node scanner) still exists — the audit must fail.
  const { doc, raw } = loadManifest();
  const original = doc.domains.session.authority;
  doc.domains.session.authority = "rust";
  const result = auditManifest({ manifest: { doc, raw } });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("session") && p.includes("marker")));
  doc.domains.session.authority = original;
});
