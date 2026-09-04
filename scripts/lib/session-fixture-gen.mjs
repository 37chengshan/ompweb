// Deterministic omp session JSONL fixture generator (5.0 W0, docs 10/12).
//
// Produces fixtures in the omp v3 session format (AGENTS.md): 256-byte padded
// title slot, session header, model_change, and a message entry tree with a
// doc-10 content mix (markdown, code blocks, tool calls/results, image
// metadata, in-session branches, compaction for XL). Same seed + scale ⇒
// byte-identical output, so baseline hashes are stable.

const B64_1PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function padTitleLine(obj) {
  // omp slots are JSON + pad spaces within 255 bytes; the entry join adds the
  // trailing "\n" so the newline lands at offset 255 — inside the 256-byte
  // window readTitleSlot scans (JSON + pad + "\n" = exactly 256 bytes).
  const json = JSON.stringify(obj);
  if (json.length >= 255) return json.slice(0, 255);
  return json + " ".repeat(255 - json.length);
}

function entryId(counter) {
  return counter.toString(16).padStart(8, "0").slice(-8);
}

const CODE_SNIPPETS = [
  'function sum(a: number, b: number): number {\n  return a + b;\n}\nconsole.log(sum(2, 3));',
  'for i in range(10):\n    if i % 2 == 0:\n        print(f"even {i}")\n    else:\n        print(f"odd {i}")',
  'curl -s https://example.com/api | jq \'.items[] | {id, name}\'',
  'SELECT u.id, count(e.id) AS events\nFROM users u LEFT JOIN events e ON e.user_id = u.id\nGROUP BY u.id\nORDER BY events DESC LIMIT 10;',
];

const MARKDOWN_SNIPPETS = [
  '## Plan\n\n1. Implement the parser\n2. Add **tests** with `node --test`\n3. Ship it\n\n| step | owner |\n|---|---|\n| parser | me |\n| tests | me |',
  'The result matches `expected == actual` for all *sampled* inputs.\n\n> Note: fixtures are deterministic — same seed, same bytes.',
  '### Findings\n\n- 137 calls across 29 files\n- `EventSource` used in 5 files\n- p95 under budget\n\n```ts\ntype Alias = { ok: boolean };\n```',
];

const TOOL_NAMES = ["read_file", "bash", "grep", "edit_file"];

function iso(tsBase, stepMinutes, rand) {
  const jitter = Math.floor(rand() * 45) * 1000;
  return new Date(tsBase + stepMinutes * 60_000 + jitter).toISOString();
}

/**
 * Build one session's JSONL content.
 * @returns {{ jsonl: string, sessionId: string, entryIds: string[] }}
 */
export function generateSessionJsonl({ messageCount, seed, cwd = "/tmp/demo-project", title }) {
  const rand = lcg(seed);
  const uuid = `${seed.toString(16).padStart(8, "0")}-4a0d-4f5e-9c1b-${(seed * 7919)
    .toString(16)
    .padStart(12, "0")
    .slice(0, 12)}`;
  const sessionId = uuid;
  const tsBase = Date.UTC(2026, 0, 1, 9, 0, 0) + (seed % 1000) * 3_600_000;

  const lines = [
    padTitleLine({
      type: "title",
      v: 1,
      title: title ?? `Fixture session ${seed}`,
      // parseTitleSlotLine only accepts "auto" | "user"; anything else makes
      // session readers treat the file as headerless and drop every entry.
      source: "auto",
      updatedAt: new Date(tsBase).toISOString(),
      pad: "",
    }),
    JSON.stringify({ type: "session", version: 3, id: uuid, timestamp: new Date(tsBase).toISOString(), cwd }),
  ];

  let counter = seed % 0xffff;
  const entryIds = [];
  const newId = () => {
    counter = (counter + 1) >>> 0;
    return entryId(counter);
  };

  const modelChangeId = newId();
  lines.push(
    JSON.stringify({
      type: "model_change",
      id: modelChangeId,
      parentId: null,
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      timestamp: iso(tsBase, 0, rand),
    }),
  );
  let parentId = modelChangeId;

  let step = 0;
  for (let m = 0; m < messageCount; m++) {
    step++;
    const ts = iso(tsBase, step, rand);
    const pattern = m % 10;

    if (pattern === 0 || pattern === 5) {
      const id = newId();
      lines.push(
        JSON.stringify({
          type: "message",
          id,
          parentId,
          message: { role: "user", content: `Question ${m}: how does module ${(m / 10) | 0} handle edge case ${m}?` },
          timestamp: ts,
        }),
      );
      parentId = id;
      entryIds.push(id);
      continue;
    }

    if (pattern === 3 || pattern === 7) {
      const callId = `call_${seed}_${m}`;
      const id = newId();
      const tool = TOOL_NAMES[m % TOOL_NAMES.length];
      lines.push(
        JSON.stringify({
          type: "message",
          id,
          parentId,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: `Running ${tool} to inspect the repo (step ${m}).` },
              {
                type: "toolCall",
                id: callId,
                name: tool,
                arguments: { path: `src/module-${m % 40}.ts`, pattern: "handle", command: `wc -l src/*.ts` },
              },
            ],
          },
          timestamp: ts,
        }),
      );
      parentId = id;
      entryIds.push(id);

      const resId = newId();
      const failed = pattern === 7;
      lines.push(
        JSON.stringify({
          type: "message",
          id: resId,
          parentId,
          message: {
            role: "toolResult",
            toolCallId: callId,
            toolName: tool,
            isError: failed,
            content: [
              {
                type: "text",
                text: failed
                  ? `Error: ${tool} failed — permission denied for src/module-${m % 40}.ts`
                  : `OK ${tool}: ${120 + (m % 300)} lines processed\nimport { x } from "./y";`,
              },
            ],
          },
          timestamp: iso(tsBase, step, rand),
        }),
      );
      parentId = resId;
      entryIds.push(resId);
      continue;
    }

    if (pattern === 9) {
      const id = newId();
      lines.push(
        JSON.stringify({
          type: "message",
          id,
          parentId,
          message: {
            role: "user",
            content: [
              { type: "text", text: `Screenshot ${m} for reference:` },
              { type: "image", data: B64_1PX_PNG, mimeType: "image/png" },
            ],
          },
          timestamp: ts,
        }),
      );
      parentId = id;
      entryIds.push(id);
      continue;
    }

    const id = newId();
    const content = [{ type: "text", text: MARKDOWN_SNIPPETS[m % MARKDOWN_SNIPPETS.length] }];
    if (pattern === 2)
      content.push({ type: "text", text: "```ts\n" + CODE_SNIPPETS[m % CODE_SNIPPETS.length] + "\n```" });
    if (pattern === 4)
      content.push({ type: "thinking", thinking: `Weighing options for step ${m}; leaning toward the cache-first fix.` });
    lines.push(
      JSON.stringify({
        type: "message",
        id,
        parentId,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input: 1000 + m, output: 200 + m, tokens: 1200 + m },
          content,
        },
        timestamp: ts,
      }),
    );
    parentId = id;
    entryIds.push(id);
  }

  return { jsonl: lines.join("\n") + "\n", sessionId, entryIds };
}

/** File name in the omp sessions dir layout: <timestamp>_<uuid>.jsonl */
export function sessionFileName(seed) {
  const ts = new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + (seed % 1000) * 3_600_000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  const uuid = `${seed.toString(16).padStart(12, "0")}-4a0d-4f5e-9c1b-${(seed * 7919)
    .toString(16)
    .padStart(12, "0")
    .slice(0, 12)}`;
  return `${ts}_${uuid}.jsonl`;
}

/** Session dir slugs, mirroring the encoded-cwd layout (path segments joined). */
export function projectSlugs() {
  return [
    "Users-cc-code-ompweb",
    "Users-cc-code-sideproject",
    "Users-cc-work-infra",
    "Users-cc-playground-rs",
    "Users-cc-docs-site",
  ];
}
