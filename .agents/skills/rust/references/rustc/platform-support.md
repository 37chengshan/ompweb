# Platform Support

Rust organizes platform support into three tiers, each with different guarantees and levels of automated testing.

## Tier System

### Tier 1 — Guaranteed to Work

- Official binary releases are provided for each target.
- Automated testing ensures the target builds and passes tests after every change.
- Full standard library support.
- All current Tier 1 targets also have host tool support (can run `rustc` and `cargo` natively).

**Examples:**

| Target | Description |
|--------|-------------|
| `aarch64-apple-darwin` | ARM64 macOS (11.0+, Big Sur+) |
| `aarch64-unknown-linux-gnu` | ARM64 Linux (kernel 4.1+, glibc 2.17+) |
| `x86_64-pc-windows-msvc` | 64-bit MSVC (Windows 10+) |
| `x86_64-unknown-linux-gnu` | 64-bit Linux (kernel 3.2+, glibc 2.17+) |

### Tier 2 — Guaranteed to Build

- Official binary releases of the standard library (or `core`) are provided.
- Automated builds ensure the target can be used as a build target after each change.
- Tests are **not** always run — a working build is not guaranteed.
- Tier 2 target-specific code receives lower scrutiny than Tier 1.

**Sub-tiers:**

| Sub-tier | Description |
|----------|-------------|
| Tier 2 with host tools | Can run `rustc` and `cargo` natively; full stdlib |
| Tier 2 without host tools | Compilation target only; stdlib may be partial (`no_std`) |

**Examples:**

| Target | Description |
|--------|-------------|
| `aarch64-unknown-linux-musl` | ARM64 Linux with musl 1.2.5 |
| `aarch64-apple-ios` | ARM64 iOS |
| `x86_64-unknown-freebsd` | 64-bit x86 FreeBSD |
| `wasm32-unknown-unknown` | WebAssembly |

### Tier 3 — Best-Effort Support

- The codebase has support, but no automated builds or tests.
- No official binary releases.
- May or may not work; no guarantees.
- Lowest quality control; target-specific code is not closely reviewed.

**Examples:**

| Target | Description |
|--------|-------------|
| `aarch64-nintendo-switch-freestanding` | ARM64 Nintendo Switch |
| `m68k-unknown-linux-gnu` | Motorola 680x0 Linux |
| `riscv64gc-unknown-hermit` | RISC-V 64-bit Hermit OS |

## Standard Library Support Key

| Symbol | Meaning |
|--------|---------|
| ✓ | Full standard library |
| `*` | `no_std` only (core + alloc) |
| `?` | Unknown / work-in-progress |

## Finding Available Targets

```bash
# List all targets in your rustc version
rustc --print target-list

# View component availability history
# https://rust-lang.github.io/rustup-components-history/
```

## Installing a Target (via rustup)

```bash
rustup target add <TARGET>

# Examples
rustup target add aarch64-unknown-linux-gnu
rustup target add wasm32-unknown-unknown
```

## Notes

- Targets are identified by a **target triple** such as `x86_64-unknown-linux-gnu` (arch-vendor-OS-ABI).
- Tier membership can change as targets gain or lose maintainers.
- The detailed tier policy is described in the Target Tier Policy document.
- Component availability (std, rustfmt, clippy, etc.) per target is tracked at https://rust-lang.github.io/rustup-components-history/

## Related

- [targets.md](./targets.md)
- [command-line-arguments.md](./command-line-arguments.md)
