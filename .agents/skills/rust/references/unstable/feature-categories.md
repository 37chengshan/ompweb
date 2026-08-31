# Unstable Book: Feature Categories

The [Rust Unstable Book](https://doc.rust-lang.org/nightly/unstable-book/) is the reference for all features available only on the **nightly** toolchain. Features are opt-in via the `#![feature(...)]` attribute (for language/library features) or via `-Z` flags (for compiler flags).

> Documentation is maintained on a best-effort basis. Always check the associated tracking issue for current status.

## Nightly Toolchain Setup

Install and use the nightly toolchain via [rustup](https://rustup.rs/):

```bash
# Install nightly
rustup toolchain install nightly

# Run with nightly for a single command
cargo +nightly build

# Set nightly as the default for a project (creates rust-toolchain.toml)
rustup override set nightly
```

## Enabling Features

Language and library features are enabled per-crate with the inner attribute at the top of `lib.rs` or `main.rs`:

```rust
#![feature(coroutines, coroutine_trait)]
```

Multiple features can be listed as a comma-separated sequence inside a single `#![feature(...)]`.

## Category 1: Language Features

Language-level extensions to the Rust syntax and type system. Enabled with `#![feature(<name>)]`.

Browse all: <https://doc.rust-lang.org/nightly/unstable-book/language-features.html>

| Feature | Tracking Issue | Description |
|---------|---------------|-------------|
| `coroutines` | [#43122](https://github.com/rust-lang/rust/issues/43122) | Resumable functions that `yield` values; compile to state machines. Extra-unstable. Used as the implementation primitive for `async`/`await` and `gen` syntax. Requires `coroutines`, `coroutine_trait`, and `stmt_expr_attributes` feature flags. |
| `gen_blocks` | [#117078](https://github.com/rust-lang/rust/issues/117078) | `gen` blocks and `gen fn` — synchronous iterator generators using `yield`. Distinct from coroutines; produces `impl Iterator`. |
| `generic_const_exprs` | [#76560](https://github.com/rust-lang/rust/issues/76560) | Non-trivial expressions in const-generic positions (e.g., `[i32; N + 1]`). Requires manual well-formedness bounds at call sites. |
| `generic_const_items` | [#113521](https://github.com/rust-lang/rust/issues/113521) | Generic parameters and `where` clauses on free and associated `const` items. |
| `specialization` | [#31844](https://github.com/rust-lang/rust/issues/31844) | More-specific trait impls override more-general ones. Blanket impls can be marked `default` to allow downstream specialization. |
| `custom_test_frameworks` | [#50297](https://github.com/rust-lang/rust/issues/50297) | Custom test runners via `#![test_runner(fn)]` and `#[test_case]`, enabling `no_std` and embedded testing. |

### Coroutines example

```rust
#![feature(coroutines, coroutine_trait, stmt_expr_attributes)]

use std::ops::{Coroutine, CoroutineState};
use std::pin::Pin;

fn main() {
    let mut gen = #[coroutine] || {
        yield 1;
        return "done";
    };
    assert_eq!(Pin::new(&mut gen).resume(()), CoroutineState::Yielded(1));
    assert_eq!(Pin::new(&mut gen).resume(()), CoroutineState::Complete("done"));
}
```

### gen_blocks example

```rust
#![feature(gen_blocks)]

fn fibonacci() -> impl Iterator<Item = u64> {
    gen {
        let (mut a, mut b) = (0u64, 1u64);
        loop {
            yield a;
            (a, b) = (b, a + b);
        }
    }
}

fn main() {
    for n in fibonacci().take(8) {
        print!("{n} "); // 0 1 1 2 3 5 8 13
    }
}
```

### Specialization example

```rust
#![feature(specialization)]

trait Describe {
    fn describe(&self) -> &str;
}

impl<T> Describe for T {
    default fn describe(&self) -> &str { "something" }
}

impl Describe for String {
    fn describe(&self) -> &str { "a String" }
}
```

## Category 2: Library Features

Unstable APIs in `std`, `core`, and `alloc`. Enabled with `#![feature(<name>)]`.

Browse all: <https://doc.rust-lang.org/nightly/unstable-book/library-features.html>

| Feature | Tracking Issue | Description |
|---------|---------------|-------------|
| `portable_simd` | [#86656](https://github.com/rust-lang/rust/issues/86656) | Cross-architecture SIMD types (`f32x4`, `u8x16`, …) in `std::simd`. Portable across x86, ARM, WASM, etc. |
| `coroutine_trait` | [#43122](https://github.com/rust-lang/rust/issues/43122) | The `std::ops::Coroutine` trait interface for polling coroutines created with the `coroutines` language feature. |
| `test` | — | Unstable benchmark harness (`#[bench]`, `Bencher::iter`). Run with `cargo bench`. |

### portable_simd example

```rust
#![feature(portable_simd)]
use std::simd::f32x4;

let a = f32x4::from_array([1.0, 2.0, 3.0, 4.0]);
let b = f32x4::from_array([10.0, 20.0, 30.0, 40.0]);
let c = a + b; // [11.0, 22.0, 33.0, 44.0]
```

### Benchmark example

```rust
#![feature(test)]
extern crate test;
use test::Bencher;

#[bench]
fn bench_sum(b: &mut Bencher) {
    b.iter(|| (0u64..1000).sum::<u64>());
}
```

## Category 3: Compiler Flags

Unstable `rustc` options passed via `-Z <flag>` (requires nightly). Some live under `-C` but accept unstable values that additionally require `-Z unstable-options`.

Browse all: <https://doc.rust-lang.org/nightly/unstable-book/compiler-flags.html>

| Flag | Description |
|------|-------------|
| `-Zsanitizer=<name>` | Instrument binaries with AddressSanitizer, ThreadSanitizer, MemorySanitizer, LeakSanitizer, etc. Requires rebuilding std with `-Zbuild-std`. |
| `-Zbuild-std` | Recompile the standard library from source for the target. Often needed alongside sanitizers or for custom targets. |
| `-Zunstable-options` | Gate-keep access to other unstable `-C`/`-Z` options; required when using unstable values of stable flags. |
| `-C codegen-units=1` | (stable flag, but some values are gated) Controls parallelism of code generation; some `linker-flavor` values require `-Z unstable-options`. |

### Sanitizer example

```bash
RUSTFLAGS="-Zsanitizer=address" \
  cargo +nightly build -Zbuild-std --target x86_64-unknown-linux-gnu
```

## Notes

- A feature that appears in the Unstable Book may be **partially stabilized** or even fully stabilized in a recent release. Always verify against the tracking issue or the [Rust release notes](https://github.com/rust-lang/rust/blob/master/RELEASES.md).
- Some features are marked **"extra-unstable"** (e.g., `coroutines`) — they may have soundness holes and are subject to change without notice.
- Use `-Z allow-features=feat1,feat2` to restrict which unstable features a build is permitted to use (useful in CI or supply-chain audits).

## Related

- [The Rust Unstable Book](https://doc.rust-lang.org/nightly/unstable-book/)
- [Rust Edition Guide](https://doc.rust-lang.org/edition-guide/)
- [Rust Reference — Feature flags](https://doc.rust-lang.org/reference/attributes/limits.html)
