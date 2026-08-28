import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Bare file/directory paths inside message text (not markdown links) become
 * clickable links so the user can open them in the sidebar viewer — the same
 * affordance images already have. The generated `link` nodes flow through the
 * existing MarkdownBody anchor handling (resolveLocalFileHref + onOpenFile).
 *
 * Matched forms:
 *   - rooted paths: /Users/x/a.md, /tmp/omp-image-1.png, C:\x\a.md, C:/x/a.md,
 *     \\server\share\f.txt, ~/x, ../x, ./x
 *   - relative multi-segment paths ending in an extension: docs/plans/x.md
 * Not matched: URLs (http/https/ftp), single-segment words, date-like tokens
 * ("2026-08-13"), "and/or"-style fragments without extensions.
 */

const PATH_CHAR = "[^\\s\"'`<>()\\[\\]{}|,;]";
// Rooted path: drive letter, UNC, ~/, ./, ../, or an absolute multi-segment
// path (leading "/" that has another "/" ahead — "and/or" stays text).
const ROOTED_PATH_RE = new RegExp(
  // "/" starts a path only at a word boundary (start/whitespace/punctuation),
  // so "and/or" never matches while /Users/... and /tmp/... always do.
  String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\{1,2}|~\/|\.\.?\/|(?<=^|[\s(,;])/(?=[^\s/]))${PATH_CHAR}*`,
  "g",
);
// Relative multi-segment path ending in an extension: docs/plans/2026-08-13-x.md
const RELATIVE_PATH_RE = new RegExp(
  String.raw`(?:^|(?<=[\s(,;]))[\w\u4e00-\u9fff.-]+(?:\/[\w\u4e00-\u9fff.-]+)+\.[a-zA-Z0-9]{1,8}(?=$|(?=[\s),;]))`,
  "g",
);

const SKIPPED_SCHEMES = /^(?:https?|ftp):\/\//i;

export interface PathToken {
  /** Original text of the token (the path, verbatim). */
  text: string;
  isPath: boolean;
}

/** Split a text node into path / non-path tokens. Pure and testable. */
export function splitPathTokens(text: string): PathToken[] {
  if (!text) return [{ text, isPath: false }];
  // Single-scheme guard: skip http(s)/ftp URLs entirely (they are either
  // already markdown links or should stay plain text).
  if (SKIPPED_SCHEMES.test(text.trim())) return [{ text, isPath: false }];

  const matches: { start: number; end: number; text: string }[] = [];

  const addMatches = (re: RegExp, source: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Skip matches that are part of a URL that slipped past the guard.
      const prefix = source.slice(Math.max(0, start - 8), start).toLowerCase();
      if (/https?:$/.test(prefix) || /^https?:\/\//.test(m[0])) continue;
      if (m[0].length === 0) re.lastIndex += 1; // never loop forever
      matches.push({ start, end, text: m[0] });
    }
  };

  // Collect from both regexes, then merge in document order so an earlier
  // relative match is never shadowed by a later rooted one (and vice versa).
  addMatches(ROOTED_PATH_RE, text);
  addMatches(RELATIVE_PATH_RE, text);
  matches.sort((a, b) => a.start - b.start || a.end - b.end);

  const tokens: PathToken[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.end <= cursor) continue; // fully consumed
    if (match.start < cursor) continue; // partial overlap — keep the earlier one
    if (cursor < match.start) {
      tokens.push({ text: text.slice(cursor, match.start), isPath: false });
    }
    tokens.push({ text: match.text, isPath: true });
    cursor = match.end;
  }
  if (cursor < text.length) {
    tokens.push({ text: text.slice(cursor), isPath: false });
  }

  return tokens;
}

/**
 * Remark plugin: rewrite text nodes into alternating text/link children so
 * bare paths become clickable.
 */
export function remarkPathLinks() {
  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;
      // Never rewrite text that is already the child of a link we just
      // created — visit() continues into replaced children and would
      // otherwise nest links infinitely.
      if (parent.type === "link") return;
      const tokens = splitPathTokens(node.value);
      if (tokens.length === 1 && !tokens[0].isPath) return;
      const children = tokens.map((token) =>
        token.isPath
          ? { type: "link" as const, url: token.text, children: [{ type: "text" as const, value: token.text }] }
          : { type: "text" as const, value: token.text },
      );
      parent.children.splice(index, 1, ...children);
    });
  };
}
