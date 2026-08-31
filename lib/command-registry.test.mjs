import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// 5.0 doc 08 Slice 1: the OMP command registry must surface in full — no
// builtin filtering, palette grouping via the ompBuiltin source, and
// client-intercepted names deduped in ChatInput.

test("omp builtin commands are no longer filtered from the registry mapping", () => {
  const src = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const fnStart = src.indexOf("function toSlashCommandInfo");
  const fnEnd = src.indexOf("}", src.indexOf("return { name: command.name", fnStart));
  const fn = src.slice(fnStart, fnEnd);
  assert.ok(!/return null;\s*$/m.test(fn.split("\n")[2] ?? ""), "builtin commands must not be dropped");
  assert.match(fn, /"ompBuiltin"/, "builtin source must map to the ompBuiltin palette group");
  assert.match(fn, /command\.source === "extension"/);
  assert.match(fn, /command\.source === "skill"/);
});

test("rpc-manager maps web get_commands onto OMP get_available_commands", () => {
  const src = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(src, /case "get_commands"/);
  assert.match(src, /get_available_commands/);
});

test("ChatInput keeps the ompBuiltin group and dedups client-intercepted names", () => {
  const src = readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
  assert.match(src, /CLIENT_BUILTIN_COMMAND_NAMES\.has\(command\.name\)/);
  assert.match(src, /source === "builtin" \|\| source === "ompBuiltin"/);
  assert.match(src, /source: "ompBuiltin" as const|source: "ompBuiltin"/);
});
