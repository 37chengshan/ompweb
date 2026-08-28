import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubRemote } from "./git-remote.ts";

test("parses https origin urls", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo", url: "https://github.com/owner/repo.git" });
  assert.deepEqual(parseGitHubRemote("https://github.com/owner/repo"), { owner: "owner", repo: "repo", url: "https://github.com/owner/repo" });
});

test("parses ssh and git urls", () => {
  assert.deepEqual(parseGitHubRemote("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo", url: "git@github.com:owner/repo.git" });
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/owner/repo.git"), { owner: "owner", repo: "repo", url: "ssh://git@github.com/owner/repo.git" });
  assert.deepEqual(parseGitHubRemote("git://github.com/owner/repo.git"), { owner: "owner", repo: "repo", url: "git://github.com/owner/repo.git" });
});

test("rejects non-github and malformed urls", () => {
  assert.equal(parseGitHubRemote("https://gitlab.com/owner/repo.git"), null);
  assert.equal(parseGitHubRemote("https://github.com/owner"), null);
  assert.equal(parseGitHubRemote("not a url"), null);
  assert.equal(parseGitHubRemote(""), null);
});