# Publishing on crates.io

crates.io is the official Rust package registry. Published crates are permanent — versions cannot be overwritten or deleted.

## Initial Setup

1. Create an account at [crates.io](https://crates.io/) (requires GitHub login)
2. Verify your email in Account Settings
3. Generate an API token at [crates.io/settings/tokens](https://crates.io/settings/tokens)
4. Authenticate locally:

```bash
cargo login
# paste your API token when prompted
```

Token is stored in `~/.cargo/credentials.toml`. Remove with `cargo logout`.

## Required Manifest Fields for Publishing

```toml
[package]
name = "my-crate"
version = "0.1.0"
description = "A short description of what this crate does"
license = "MIT OR Apache-2.0"      # or license-file = "LICENSE"
repository = "https://github.com/example/my-crate"
readme = "README.md"
```

Optional but recommended:

```toml
keywords = ["cli", "utility"]      # max 5
categories = ["command-line-utilities"]  # max 5, from crates.io list
homepage = "https://example.com"
documentation = "https://docs.rs/my-crate"
```

## Packaging and Verification

Check what files will be included:

```bash
cargo package --list
```

Dry run (verify without uploading):

```bash
cargo publish --dry-run
```

This creates a `.crate` file in `target/package/`, verifies it compiles correctly in a temporary directory, and checks for crates.io size limit (10 MB).

Control included files:

```toml
[package]
exclude = ["public/assets/*", "videos/*"]
# or:
include = ["**/*.rs", "Cargo.toml", "README.md"]
```

Cargo automatically excludes VCS-ignored files.

## Publishing

```bash
cargo publish
```

The registry will:
1. Verify the package
2. Compile and check it
3. Upload to crates.io
4. Make it publicly available

Note: New crate names must be available. If the name is taken, you'll need to choose another.

## Publishing New Versions

1. Update `version` in `Cargo.toml` following [SemVer rules](./reference-semver.md)
2. Run `cargo publish`

Recommended release process:
- Update `CHANGELOG.md`
- Create a git tag at the published commit
- Consider automation: [`cargo-release`](https://crates.io/crates/cargo-release), [`release-plz`](https://crates.io/crates/release-plz)

## Restricting Publication

Prevent publishing to any registry:

```toml
[package]
publish = false
```

Allow only specific registries:

```toml
[package]
publish = ["my-registry", "crates-io"]
```

## Managing Published Crates

### Yanking Versions

Mark a version as not recommended for new projects while keeping existing dependents working:

```bash
cargo yank --version 1.0.1          # yank
cargo yank --version 1.0.1 --undo   # restore
```

What yanking does:
- Prevents new `Cargo.lock` entries from selecting this version
- Existing `Cargo.lock` files continue to use it
- Does NOT delete code — cannot remove secrets this way

### Managing Ownership

```bash
cargo owner --add github-username          # add owner
cargo owner --remove github-username       # remove owner
cargo owner --add github:org:team-name     # add GitHub team
cargo owner --remove github:org:team-name  # remove GitHub team
cargo owner --list                         # list owners
```

**Named owners** (GitHub users): Full publish/yank rights, can add/remove owners.

**Team owners**: Can publish/yank but cannot add/remove owners. More secure against malicious actors.

## Notes

- Publishing is permanent. Do not publish crates containing secrets.
- crates.io name requirements: ASCII only, max 64 chars, no Windows-reserved names.
- `keywords` max: 5 entries, alphanumeric + `_-+`, 20 chars each.
- `categories` must exactly match [crates.io category slugs](https://crates.io/category_slugs).
- Maximum 300 features per published crate.

## Related

- [reference-manifest.md](./reference-manifest.md)
- [reference-registry-auth.md](./reference-registry-auth.md)
- [reference-registries.md](./reference-registries.md)
- [reference-semver.md](./reference-semver.md)
