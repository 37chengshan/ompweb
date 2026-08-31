# Sanitizers

Sanitizers instrument code with runtime checks to detect bugs such as memory errors, data races, leaks, and control flow violations. All sanitizers require nightly Rust (`-Z` flags).

## Signature / Usage

```bash
RUSTFLAGS="-Z sanitizer=<NAME>" cargo build -Z build-std --target <TARGET>
```

## Available Sanitizers

### For Testing / Fuzzing Only (not for production)

| Sanitizer | Flag | Detects |
|-----------|------|---------|
| AddressSanitizer | `-Z sanitizer=address` | Out-of-bounds, use-after-free, double-free, leaks |
| HWAddressSanitizer | `-Z sanitizer=hwaddress` | Same as ASan with lower memory overhead (hardware-assisted) |
| KernelHWAddressSanitizer | `-Z sanitizer=kernel-hwaddress` | HWASan for bare-metal |
| LeakSanitizer | `-Z sanitizer=leak` | Runtime memory leaks |
| MemorySanitizer | `-Z sanitizer=memory` | Use of uninitialized memory |
| RealtimeSanitizer | `-Z sanitizer=realtime` | Non-deterministic execution in real-time contexts |
| ThreadSanitizer | `-Z sanitizer=thread` | Data races in multi-threaded code |

### Production-Safe Sanitizers

| Sanitizer | Flag | Purpose |
|-----------|------|---------|
| ControlFlowIntegrity (CFI) | `-Z sanitizer=cfi` | Forward-edge control flow protection (requires LTO) |
| DataFlowSanitizer | `-Z sanitizer=dataflow` | Dynamic data flow analysis framework |
| KernelControlFlowIntegrity (KCFI) | `-Z sanitizer=kcfi` | CFI for OS kernels |
| MemTagSanitizer | `-Z sanitizer=memtag` | Hardware memory error detection (Armv8.5-A MTE) |
| SafeStack | `-Z sanitizer=safestack` | Backward-edge CFP via separate safe/unsafe stacks |
| ShadowCallStack | `-Z sanitizer=shadow-call-stack` | Return address protection (AArch64 only) |

## Platform Support

| Sanitizer | Supported Targets |
|-----------|-------------------|
| AddressSanitizer | `aarch64-apple-darwin`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-unknown-freebsd`, `*-fuchsia` |
| HWAddressSanitizer | `aarch64-linux-android`, `aarch64-unknown-linux-gnu` |
| LeakSanitizer | `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu` |
| MemorySanitizer | `aarch64-unknown-linux-gnu`, `x86_64-unknown-linux-gnu`, `x86_64-unknown-freebsd` |
| ThreadSanitizer | `aarch64-apple-darwin`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-unknown-freebsd` |
| ShadowCallStack | `aarch64-linux-android`, `aarch64-unknown-fuchsia`, `aarch64-unknown-none`, `riscv64*` |
| SafeStack | `x86_64-unknown-linux-gnu` |
| MemTagSanitizer | `aarch64-linux-android`, `aarch64-unknown-linux-gnu` |

## Usage Examples

### AddressSanitizer

```rust
fn main() {
    let xs = [0, 1, 2, 3];
    let _y = unsafe { *xs.as_ptr().offset(4) }; // out-of-bounds
}
```

```bash
export RUSTFLAGS=-Zsanitizer=address RUSTDOCFLAGS=-Zsanitizer=address
cargo run -Zbuild-std --target x86_64-unknown-linux-gnu
# ==ERROR: AddressSanitizer: stack-buffer-overflow
```

### ThreadSanitizer

```rust
static mut A: usize = 0;
fn main() {
    let t = std::thread::spawn(|| unsafe { A += 1 });
    unsafe { A += 1 };
    t.join().unwrap();
}
```

```bash
export RUSTFLAGS=-Zsanitizer=thread RUSTDOCFLAGS=-Zsanitizer=thread
cargo run -Zbuild-std --target x86_64-unknown-linux-gnu
# WARNING: ThreadSanitizer: data race
```

### MemorySanitizer

```bash
export RUSTFLAGS='-Zsanitizer=memory -Zsanitizer-memory-track-origins'
cargo clean
cargo run -Zbuild-std --target x86_64-unknown-linux-gnu
```

### ControlFlowIntegrity (requires LTO)

```bash
RUSTFLAGS="-C linker-plugin-lto -C linker=clang -C link-arg=-fuse-ld=lld -Z sanitizer=cfi" \
  cargo run -Zbuild-std -Zbuild-std-features --release --target x86_64-unknown-linux-gnu
```

### RealtimeSanitizer

```rust
#![feature(sanitize)]

#[sanitize(realtime = "nonblocking")]
fn real_time_fn() {
    let v = vec![0, 1, 2]; // malloc detected at runtime!
}
```

## Additional Flags

| Flag | Description |
|------|-------------|
| `-Z build-std` | Rebuild standard library with sanitizer instrumentation (recommended) |
| `-Z external-clangrt` | Use external Clang runtime (for C/C++ interop) |
| `-Z sanitizer-memory-track-origins` | Track origins of uninitialized memory (MSan) |
| `-Z sanitizer-cfi-normalize-integers` | Normalize integers for cross-language CFI |
| `-C llvm-args=<ARGS>` | Pass LLVM options (e.g. `-pgo-warn-missing-function`) |

## Notes

- Sanitizers require **nightly Rust**.
- Always specify `--target` to prevent sanitizer flags from being applied to build scripts and proc-macros.
- Use `-Z build-std` to instrument the standard library; without it, some errors may be missed.
- Add `llvm-symbolizer` to `PATH` for readable stack traces in reports.
- When mixing Rust and C/C++, use `-Z external-clangrt` to avoid runtime conflicts.
- LeakSanitizer is enabled by default in AddressSanitizer on Linux; use `ASAN_OPTIONS=detect_leaks=1` on macOS.
- ThreadSanitizer does not support `std::sync::atomic::fence` or inline assembly synchronization.

## Related

- [exploit-mitigations.md](./exploit-mitigations.md)
- [codegen-options.md](./codegen-options.md)
- [linker-plugin-lto.md](./linker-plugin-lto.md)
