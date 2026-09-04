# Lints

A "lint" is a diagnostic that helps improve source code quality. `rustc` runs lints during compilation and may produce warnings or errors based on configuration.

## Signature / Usage

```bash
# Set lint levels via command-line flags
rustc -W missing_docs -D warnings -A dead_code input.rs

# Set lint levels via source attributes
#![warn(missing_docs)]
#![deny(unused_variables)]
```

## Lint Levels

| Level | Description |
|-------|-------------|
| `allow` | Lint is suppressed; no output |
| `expect` | Lint is suppressed but triggers `unfulfilled_lint_expectations` if the lint never fires |
| `warn` | Produces a warning |
| `force-warn` | Always warns; cannot be overridden by attributes or other flags (except `--cap-lints`) |
| `deny` | Produces a compile error |
| `forbid` | Like `deny` but cannot be overridden to a lower level |

## Setting Lint Levels

### Via Command-line Flags

| Flag | Level | Example |
|------|-------|---------|
| `-A LINT` | allow | `-A dead-code` |
| `-W LINT` | warn | `-W missing-docs` |
| `--force-warn LINT` | force-warn | `--force-warn unsafe-code` |
| `-D LINT` | deny | `-D warnings` |
| `-F LINT` | forbid | `-F unsafe-code` |
| `--cap-lints LEVEL` | cap maximum | `--cap-lints warn` |

### Via Source Attributes

```rust
// Crate-level (inner attribute)
#![warn(missing_docs)]
#![deny(unused_variables)]

// Item-level (outer attribute)
#[allow(unused_variables)]
fn main() {
    let x = 5; // no warning
}

// With reason (shown in diagnostic)
#[allow(unused_mut, reason = "only modified on some platforms")]
let mut x = 5;
```

## Priority Rules

1. `--force-warn` — highest; overrides attributes and all other flags
2. `--cap-lints` — sets maximum level; caps `-D`, `-W`, `-F` and attribute-set levels
3. CLI flags (`-A`, `-W`, `-D`, `-F`) — rightmost flag for the same lint wins
4. Source attributes — item-level overrides crate-level; `forbid` cannot be lowered

## Lint Categories / Listing

| Category | Description |
|----------|-------------|
| Allow-by-default | Lints that are off unless explicitly enabled |
| Warn-by-default | Lints that produce warnings by default (e.g. `unused_variables`) |
| Deny-by-default | Lints that produce errors by default |

List all lints for your version of `rustc`:

```bash
rustc -W help
```

## Lint Groups

| Group | Description |
|-------|-------------|
| `warnings` | All lints that issue warnings |
| `future-incompatible` | Code with future-compatibility problems |
| `nonstandard-style` | Standard naming convention violations (`non_camel_case_types`, etc.) |
| `unused` | Unused declarations and excess syntax |
| `rust-2018-idioms` | Idiomatic Rust 2018 features |
| `rust-2018-compatibility` | 2015→2018 edition transition |
| `rust-2021-compatibility` | 2018→2021 edition transition |
| `rust-2024-compatibility` | 2021→2024 edition transition |
| `keyword-idents` | Identifiers that will become future keywords |
| `let-underscore` | Invalid wildcard let bindings |
| `deprecated-safe` | Functions erroneously marked safe |

## Notes

- Future-incompatible lints warn about code that will become an error in a future release. They include a link to a tracking issue.
- `--cap-lints allow` is commonly used in dependencies to suppress all warnings from third-party crates.
- `--force-warn` cannot be set via source attributes; only via CLI.
- `#[expect]` is useful for documenting intentionally suppressed lints and detecting when a lint no longer fires.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
- [check-cfg.md](./check-cfg.md)
