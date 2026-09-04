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

test("ownership manifest: agent has cut over to rust with explicit node fallback", () => {
  const result = auditManifest();
  assert.equal(result.domains.agent, "rust");
  // The manifest's fallback field keeps the gate green while the explicit
  // rollback path (OMPWEB_BACKEND=node) remains.
  assert.equal(result.ok, true, result.problems.join("; "));
});

test("ownership manifest: rust gate scan rejects node markers for rust domains", () => {
  // Simulate a drift: flip session to rust WITHOUT the explicit node fallback
  // while the Node scanner still exists — the audit must fail. (With
  // fallback: node the gate stays green by design — see the cutover test.)
  const { doc, raw } = loadManifest();
  const originalAuthority = doc.domains.session.authority;
  const originalFallback = doc.domains.session.fallback;
  doc.domains.session.authority = "rust";
  delete doc.domains.session.fallback;
  const result = auditManifest({ manifest: { doc, raw } });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("session") && p.includes("marker")));
  doc.domains.session.authority = originalAuthority;
  if (originalFallback !== undefined) doc.domains.session.fallback = originalFallback;
});
