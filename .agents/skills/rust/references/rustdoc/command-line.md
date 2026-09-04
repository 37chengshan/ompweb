# Command-Line Arguments

Reference for all `rustdoc` command-line flags.

## Basic Usage

```bash
rustdoc [OPTIONS] <INPUT>
rustdoc src/lib.rs --crate-name mycrate -o target/doc
```

## Options / Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Print help information |
| `-V`, `--version` | Print version |
| `-v`, `--verbose` | Enable verbose output |
| `-o`, `--out-dir <PATH>` | Output directory (default: `doc/`) |
| `--crate-name <NAME>` | Override crate name (default: filename without `.rs`) |
| `--document-private-items` | Include non-public items (marked with 🔒) |
| `-L`, `--library-path <PATH>` | Directory to search for dependencies |
| `--extern <NAME>=<PATH>` | Exact location of a dependency |
| `--cfg <SPEC>` | Pass cfg flags (same format as `rustc`) |
| `--check-cfg <SPEC>` | Check configuration flags |
| `-C`, `--codegen <OPT>` | Pass codegen options to rustc |
| `--edition <YEAR>` | Rust edition (`2015`, `2018`, `2021`, `2024`) |
| `--target <TRIPLE>` | Generate docs for a specific target triple |
| `--sysroot <PATH>` | Override sysroot path |

### Testing

| Flag | Description |
|------|-------------|
| `--test` | Run doc examples as tests |
| `--test-args <ARGS>` | Arguments forwarded to the test runner |
| `--test-run-directory <PATH>` | Working directory for running tests |
| `--test-runtool <PATH>` | Wrapper program for running tests (e.g., `valgrind`) |
| `--test-runtool-arg <ARG>` | Argument passed to the runtool |

### HTML Customization

| Flag | Description |
|------|-------------|
| `--default-theme <THEME>` | Default theme (`ayu`, `light`, `rust`, etc.) |
| `--theme <PATH>` | Add a custom theme CSS file |
| `--check-theme <PATH>` | Verify a custom theme against the default |
| `-e`, `--extend-css <PATH>` | Extend rustdoc's CSS |
| `--html-in-header <PATH>` | Insert HTML into `<head>` |
| `--html-before-content <PATH>` | Insert HTML after `<body>` |
| `--html-after-content <PATH>` | Insert HTML before `</body>` |
| `--markdown-css <PATH>` | Additional CSS for standalone Markdown files |
| `--markdown-playground-url <URL>` | Base URL for Playground "Run" buttons |
| `--markdown-no-toc` | Suppress table of contents in Markdown output |
| `--crate-version <VERSION>` | Display version in sidebar |

### Miscellaneous

| Flag | Description |
|------|-------------|
| `-` | Read source from stdin |
| `@<PATH>` | Load flags from a file (one per line) |
| `--passes` | (Deprecated) Add a rustdoc pass |
| `--no-defaults` | (Deprecated) Skip default passes |

## Notes

- `--document-private-items` replaces the old `--no-defaults`/`strip-private` pass pattern.
- Unstable options require `-Z unstable-options` on nightly (e.g., `--output-format json`, `--show-coverage`).
- Cargo passes `-o`, `-L`, and `--extern` automatically; prefer `cargo doc` over direct `rustdoc` invocation.

## Related

- [Unstable features](./unstable-features.md)
- [Passes (deprecated)](./passes.md)
