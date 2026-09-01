# Release Checklist

Each release publishes two artifacts:

- npm package: `@37chengshan/ompweb`
- GitHub Release: [37chengshan/ompweb](https://github.com/37chengshan/ompweb)

After the initial bootstrap release, publishing is performed by GitHub Actions
with npm trusted publishing. No npm access token is stored in this repository
or in GitHub secrets.

## Release preflight

`@37chengshan/ompweb` already exists on npm. Every new version must be published
by the configured GitHub Actions trusted publisher. Before creating a tag, verify
that the package name, GitHub repository, workflow filename, and npm environment
match the trusted-publisher configuration below:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
npm view @37chengshan/ompweb version --registry=https://registry.npmjs.org/
```

## One-time trusted-publisher setup

1. In npm, open the `@37chengshan/ompweb` package settings and add a **GitHub Actions**
   trusted publisher with:
   - Owner: `37chengshan`
   - Repository: `ompweb`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. In GitHub, create the `npm` environment for this repository. Add required
   reviewers if releases need approval.
3. Confirm Actions are enabled for the repository.

The workflow at `.github/workflows/publish.yml` requests `contents: write` to
create the GitHub Release and `id-token: write` for trusted publishing. It
installs npm 11.5.1 or newer, as required for trusted publishing. The OIDC
permission lets npm verify the GitHub Actions identity and generate provenance
for the published package.

## Release later versions

Run these from a clean `main` checkout after the release changes are merged.

```bash
npm ci
npm test
npm run build
npm version <major|minor|patch>
git push origin main --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, creates a commit,
and creates a `v<version>` tag. Review the generated commit before pushing.

Pushing the tag starts the `Publish npm package` workflow. It checks out that
immutable tag, verifies the tag matches `package.json`, installs from the
lockfile, runs tests and the production build, then creates a draft GitHub
Release with generated notes. It publishes `ompweb` through the configured
trusted publisher and makes that release public only after npm accepts the
package. A rerun can safely finish a release if npm has already accepted its
version.

## Verify

```bash
gh run list --repo 37chengshan/ompweb --workflow publish.yml --limit 1
npm view @37chengshan/ompweb@<version> version --registry https://registry.npmjs.org/
npm view @37chengshan/ompweb@<version> --json --registry https://registry.npmjs.org/
```

Confirm the workflow succeeded, the exact package version resolves, and npm
shows the expected provenance link.

If a local `npm publish` fails with `EPIPE`, first verify `npm whoami` and
`npm ping` against `https://registry.npmjs.org/`, then retry with the explicit
registry flag. An `EPIPE` is a registry connection interruption; it is different
from a trusted-publisher permission error in GitHub Actions.
