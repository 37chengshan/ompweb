# External Tools

Cargo provides facilities for third-party tools (IDEs, build systems, custom subcommands) to integrate with the Cargo ecosystem.

## Custom Subcommands

### Naming Convention: `cargo-*`

Any executable named `cargo-<command>` in `$PATH` (or `$CARGO_HOME/bin/`) becomes a Cargo subcommand:

```bash
# executable: cargo-foo
cargo foo       # invokes cargo-foo
cargo help foo  # invokes cargo-foo foo --help
```

**Precedence**: `$CARGO_HOME/bin` takes precedence over `$PATH`, but users can override by adjusting `$PATH`.

**Arguments received by the executable:**
1. Filename of the subcommand binary
2. Subcommand name (e.g., `foo`)
3. Any additional arguments, forwarded unchanged

**Recommended integration**: Use the `CARGO` environment variable or `cargo metadata` rather than linking to Cargo's internal library API (which is unstable).

## Machine-Readable Output: `--message-format=json`

Build with JSON output (one JSON object per line) for IDE/tool integration:

```bash
cargo build --message-format=json
```

### Message Types

**Compiler message** (`"reason": "compiler-message"`):

```json
{
    "reason": "compiler-message",
    "package_id": "file:///path/to/my-package#0.1.0",
    "target": {
        "kind": ["lib"],
        "name": "my_package",
        "src_path": "/path/to/src/lib.rs",
        "edition": "2021"
    },
    "message": { /* rustc JSON diagnostic format */ }
}
```

**Compiler artifact** (`"reason": "compiler-artifact"`):

```json
{
    "reason": "compiler-artifact",
    "package_id": "file:///path/to/my-package#0.1.0",
    "target": { /* ... */ },
    "profile": {
        "opt_level": "0",
        "debuginfo": 2,
        "debug_assertions": true,
        "overflow_checks": true,
        "test": false
    },
    "features": ["feat1"],
    "filenames": ["/path/to/target/debug/libmy_package.rlib"],
    "executable": null,
    "fresh": true
}
```

**Build script executed** (`"reason": "build-script-executed"`):

```json
{
    "reason": "build-script-executed",
    "package_id": "file:///path/to/my-package#0.1.0",
    "linked_libs": ["foo"],
    "linked_paths": ["/usr/lib"],
    "cfgs": ["my_cfg"],
    "env": [["MY_VAR", "value"]],
    "out_dir": "/path/in/target/dir"
}
```

**Build finished** (`"reason": "build-finished"`):

```json
{ "reason": "build-finished", "success": true }
```

**Note**: Only parse lines starting with `{` as JSON — procedural macros may emit non-JSON output.

## `cargo metadata`

Outputs stable, versioned JSON with complete package structure and dependency information:

```bash
cargo metadata --format-version 1
```

Always pass `--format-version` explicitly to avoid forward incompatibility.

Use the [`cargo_metadata`](https://crates.io/crates/cargo_metadata) Rust crate to parse the output safely.

## Notes

- `--message-format=json` only controls Cargo's own output. Other tools (proc-macros) may still emit non-JSON lines.
- The `package_id` field uses Package ID Specification format (requires Rust 1.77+).
- Linking to Cargo as a library is not recommended — the API is unstable and may change without notice.

## Related

- [commands.md](./commands.md)
- [reference-build-scripts.md](./reference-build-scripts.md)
