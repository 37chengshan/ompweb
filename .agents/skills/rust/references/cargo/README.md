# cargo

| Name | Description | Path |
|------|-------------|------|
| Build Scripts | Build scripts are Rust programs that run before the package is compiled. They integrate C libraries, generate code, and perform platform-specific configuration. | [reference-build-scripts.md](./reference-build-scripts.md) |
| Cargo Commands | Reference for all Cargo CLI commands. Run `cargo help <command>` or `cargo <command> --help` for detailed options. | [commands.md](./commands.md) |
| Cargo FAQ | Frequently asked questions about Cargo's design and behavior. | [faq.md](./faq.md) |
| Cargo Guide | A practical guide to using Cargo for everyday Rust development. | [cargo-guide.md](./cargo-guide.md) |
| Cargo.toml vs Cargo.lock | Cargo uses two complementary files for dependency management. Understanding the difference is essential for reproducible builds. | [reference-cargo-toml.md](./reference-cargo-toml.md) |
| Configuration | Cargo reads configuration from `.cargo/config.toml` files. Settings are merged hierarchically from the current directory up to the home directory. | [reference-config.md](./reference-config.md) |
| Dependency Resolution | Cargo's dependency resolver determines which specific versions of dependencies to use. The result is stored in `Cargo.lock`. | [reference-resolver.md](./reference-resolver.md) |
| Environment Variables | Cargo reads environment variables to configure its behavior and sets variables for crates and build scripts at compile time. | [reference-environment-variables.md](./reference-environment-variables.md) |
| External Tools | Cargo provides facilities for third-party tools (IDEs, build systems, custom subcommands) to integrate with the Cargo ecosystem. | [reference-external-tools.md](./reference-external-tools.md) |
| Features | Cargo features provide a mechanism for conditional compilation and optional dependencies. Features are declared in `[features]` in `Cargo.toml` and enabled at compile time. | [reference-features.md](./reference-features.md) |
| Getting Started with Cargo | Cargo is the Rust package manager and build tool. It handles downloading dependencies, compiling packages, and distributing Rust libraries. Installing Rust via rustup automatically installs Cargo. | [getting-started.md](./getting-started.md) |
| Lints | Cargo supports a `[lints]` table for configuring lint levels for `rustc`, Clippy, and `rustdoc` lints, as well as Cargo's own lint system. | [reference-lints.md](./reference-lints.md) |
| Overriding Dependencies | Cargo provides mechanisms to temporarily override dependencies — useful for testing local bug fixes, working with unpublished code, or testing breaking changes before publication. | [reference-overriding-dependencies.md](./reference-overriding-dependencies.md) |
| Profiles | Profiles configure compiler settings for different build scenarios. They are defined in `[profile.NAME]` sections in `Cargo.toml` (workspace root only). | [reference-profiles.md](./reference-profiles.md) |
| Publishing on crates.io | crates.io is the official Rust package registry. Published crates are permanent — versions cannot be overwritten or deleted. | [reference-publishing.md](./reference-publishing.md) |
| Registry Authentication | Cargo authenticates to registries using credential providers — external executables or built-in providers that store and retrieve tokens. | [reference-registry-auth.md](./reference-registry-auth.md) |
| Registries | A registry is a source from which Cargo installs crates and fetches dependencies. The default registry is [crates.io](https://crates.io/). | [reference-registries.md](./reference-registries.md) |
| SemVer Compatibility | Semantic Versioning (SemVer) defines what changes require a major, minor, or patch version bump. These are guidelines — the focus is on changes that cause **compilation failures** in downstream crates. | [reference-semver.md](./reference-semver.md) |
| Source Replacement | Source replacement redirects Cargo's communication with a registry or git source to an alternative. It is used for vendoring (offline builds) and mirroring (caching). | [reference-source-replacement.md](./reference-source-replacement.md) |
| Specifying Dependencies | Dependencies are declared in `Cargo.toml` under `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, or platform-specific sections. | [reference-specifying-dependencies.md](./reference-specifying-dependencies.md) |
| The Manifest Format (Cargo.toml) | `Cargo.toml` is the manifest file for each Rust package, written in TOML. It declares metadata, dependencies, build targets, and compilation settings. | [reference-manifest.md](./reference-manifest.md) |
| Unstable Features | Unstable features are experimental Cargo capabilities available only on the **nightly toolchain**. They allow community testing before stabilization. Features with no major concerns are stabilized and appear on stable 6–12 weeks later. | [reference-unstable.md](./reference-unstable.md) |
| Workspaces | A workspace is a collection of one or more Cargo packages (workspace members) managed together under a single `Cargo.lock` and shared `target/` directory. | [reference-workspaces.md](./reference-workspaces.md) |
