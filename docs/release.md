# Release Checklist

Each release publishes two artifacts:

- npm package: `@kahme247/ompweb`
- GitHub Release: [kahme247/ompweb](https://github.com/kahme247/ompweb)

After the initial bootstrap release, publishing is performed by GitHub Actions
with npm trusted publishing. No npm access token is stored in this repository
or in GitHub secrets.

## Bootstrap the first release

`@kahme247/ompweb` is not registered on npm yet. npm exposes trusted-publisher settings
only for an existing package, so version `0.2.0` must be published once from a
reviewed local checkout using the authenticated npm account:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
npm publish --access public
```

Do not create a GitHub Release for this bootstrap version: the publish workflow
is intentionally release-triggered and npm will reject a duplicate version.
After this succeeds, configure trusted publishing before publishing any later
version.

## One-time trusted-publisher setup

1. In npm, open the `@kahme247/ompweb` package settings and add a **GitHub Actions**
   trusted publisher with:
   - Owner: `kahme247`
   - Repository: `ompweb`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. In GitHub, create the `npm` environment for this repository. Add required
   reviewers if releases need approval.
3. Confirm Actions are enabled for the repository.

The workflow at `.github/workflows/publish.yml` requests only `contents: read`
and `id-token: write`. It installs npm 11.5.1 or newer, as required for trusted
publishing. The OIDC permission lets npm verify the GitHub Actions identity and
generate provenance for the published package.

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

Then create and publish the matching GitHub Release:

```bash
gh release create v<version> \
  --repo kahme247/ompweb \
  --verify-tag \
  --title "v<version>" \
  --generate-notes
```

Publishing the GitHub Release starts the `Publish npm package` workflow. It
checks out that immutable tag, verifies the tag matches `package.json`, installs
from the lockfile, runs tests and the production build, then publishes `ompweb`
through the configured trusted publisher.

## Verify

```bash
gh run list --repo kahme247/ompweb --workflow publish.yml --limit 1
npm view @kahme247/ompweb@<version> version --registry https://registry.npmjs.org/
npm view @kahme247/ompweb@<version> --json --registry https://registry.npmjs.org/
```

Confirm the workflow succeeded, the exact package version resolves, and npm
shows the expected provenance link.
