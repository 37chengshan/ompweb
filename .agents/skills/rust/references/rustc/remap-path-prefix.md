# Remap Source Paths

`--remap-path-prefix` rewrites source file paths embedded in compiler output (error messages, debug info, coverage maps, and macro expansions) to enable reproducible builds and protect local filesystem paths.

## Signature / Usage

```bash
rustc --remap-path-prefix FROM=TO [--remap-path-prefix FROM2=TO2 ...] INPUT
```

The flag is repeatable. Remapping is applied to all paths that begin with `FROM`; the prefix is replaced with `TO`.

```bash
# Strip absolute source paths for reproducible builds
rustc --remap-path-prefix /home/user/project=/project src/main.rs

# Replace home directory with a canonical placeholder
rustc --remap-path-prefix "$HOME"=/home/user src/main.rs
```

## Options / Props

| Flag | Description |
|------|-------------|
| `--remap-path-prefix FROM=TO` | Replace path prefix `FROM` with `TO` in all compiler output |

## Scope of Remapping

Remapping applies to paths embedded in:

- Error messages and diagnostics
- Debug information (DWARF)
- Coverage maps
- `file!()` macro expansions
- Metadata and build artifacts

## Notes

- The order of `--remap-path-prefix` flags matters; the first matching prefix wins.
- Cargo exposes this as `CARGO_ENCODED_RUSTFLAGS` or via `[profile.*.build-override]`; Cargo itself does not automatically add remapping.
- Combining with `--remap-path-scope` (unstable) allows limiting remapping to specific output types.
- Path remapping does not affect the paths used to *locate* source files; it only affects paths *recorded* in output.

## Related

- [Command-line Arguments](./command-line-arguments.md)
- [Codegen Options](./codegen-options.md)
- [Exploit Mitigations](./exploit-mitigations.md)
