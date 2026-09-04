# Transitioning an Existing Project to a New Edition

Rust provides `cargo fix --edition` to automate most of the work. Follow the steps below in order.

## Signature / Usage

```bash
# Full migration workflow
cargo update                # 1. Update dependencies
cargo fix --edition         # 2. Auto-fix source code
# Edit Cargo.toml: set edition = "2021"  (step 3)
cargo build && cargo test   # 4. Verify
cargo fmt                   # 5. Reformat with new style rules
```

## Step-by-Step

### 1. Update dependencies

```bash
cargo update
```

Some dependencies (especially proc-macros) may have edition-related issues in old versions. Update and run tests before proceeding.

### 2. Auto-fix source code

```bash
cargo fix --edition
```

`cargo fix` rewrites source files to be compatible with the target edition. If a change cannot be automated, it prints a warning requiring manual intervention.

### 3. Enable the new edition in Cargo.toml

```toml
[package]
name = "foo"
version = "0.1.0"
edition = "2021"
```

### 4. Build and test

```bash
cargo build
cargo test
```

Run `cargo fix` again (without `--edition`) if new warnings appear after enabling the edition.

### 5. Reformat

```bash
cargo fmt
```

The new edition may have updated rustfmt style rules. Commit formatting changes separately from logic changes.

## Notes

- `cargo fix` does **not** automatically update doctests or code generated at build time — these require manual review.
- For large workspaces or unusual configurations, see "Advanced migration strategies" in the Edition Guide.
- To test an unstable (nightly) edition:
  ```bash
  rustup update nightly
  cargo +nightly fix --edition
  # Add to Cargo.toml:
  # cargo-features = ["edition20xx"]
  # edition = "20xx"
  cargo +nightly check
  ```
- File bug reports at https://github.com/rust-lang/rust/issues/new/choose if migration is unusually difficult.

## Related

- [What are Editions?](./what-is-edition.md)
- [Rust 2018](./rust-2018.md)
- [Rust 2021](./rust-2021.md)
- [Rust 2024](./rust-2024.md)
