# Check cfg

`--check-cfg` instructs `rustc` to verify that every reachable `#[cfg]` attribute matches a declared list of expected configuration names and values. Unexpected configurations produce an `unexpected_cfgs` lint warning.

## Signature / Usage

```bash
rustc --check-cfg 'cfg(name, values("value1", "value2"))' input.rs
```

## Syntax

```
--check-cfg 'cfg(NAME [, values(VALUE_LIST)])'
```

| Part | Format | Description |
|------|--------|-------------|
| `NAME` | bare identifier | Configuration name to expect (e.g. `feature`, `my_cfg`) |
| `VALUE_LIST` | quoted strings, `none()`, or `any()` | Expected values for the name |

### Value List Patterns

| Syntax | Meaning |
|--------|---------|
| `values("a", "b")` | Expect exactly these string values |
| `values(none())` | Expect bare form (`#[cfg(foo)]`) only |
| `values()` | Expect the name; lint all values |
| `values(any())` | Expect the name; never lint values |
| `cfg()` | Enable checking mode; no specific names declared |

Multiple `--check-cfg` arguments for the same name merge their value sets (with `values(any())` taking precedence).

## Example

```bash
rustc --check-cfg 'cfg(feature, values("lion", "zebra"))' \
      --cfg 'feature="lion"' example.rs
```

```rust
#[cfg(feature = "lion")]      // OK: in declared values
fn tame_lion() {}

#[cfg(feature = "zebra")]     // OK: declared (evaluates false)
fn ride_zebra() {}

#[cfg(feature = "platypus")]  // WARN: unexpected_cfgs — not in values
fn poke_platypus() {}

#[cfg(feechure = "lion")]     // WARN: unexpected_cfgs — name not declared
fn tame_lion2() {}
```

## What Gets Checked

- `#[cfg(name = "value")]`
- `#[cfg_attr(name = "value")]`
- `#[link(name = "a", cfg(name = "value"))]`
- `cfg!(name = "value")` macro calls

Note: `--cfg` command-line arguments are **not** currently checked but may be in the future.

## Well-Known Names (Auto-Included)

When at least one `--check-cfg` argument is present, `rustc` automatically includes these well-known names:

`clippy`, `debug_assertions`, `doc`, `doctest`, `fmt_debug`, `miri`, `overflow_checks`, `panic`, `proc_macro`, `relocation_model`, `rustfmt`, `sanitize`, `sanitizer_cfi_*` variants, `target_*` (abi, arch, endian, env, family, feature, has_atomic*, os, pointer_width, thread_local, vendor), `ub_checks`, `unix`, `windows`

Note: Starting with Rust 1.85.0, `test` is treated as userspace config.

## Diagnostic Level

The `unexpected_cfgs` lint defaults to **Warn**. It can be configured like any lint:

```rust
#![deny(unexpected_cfgs)]
```

## Notes

- The flag must be repeated for each name/value set; multiple invocations merge value sets.
- Without any `--check-cfg` argument, `rustc` does not check cfg at all.
- Cargo automatically generates `--check-cfg` arguments for `[features]` declared in `Cargo.toml`. See Cargo documentation for Cargo-specific usage.
- Only **reachable** `#[cfg]` attributes are currently checked; unreachable ones may be checked in the future.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
- [lints.md](./lints.md)
