# Unsorted Topics

Miscellaneous topics that don't fit cleanly into other chapters, including optimization strategies for embedded firmware.

## Speed vs Size Optimization

Embedded firmware must fit in limited Flash and execute within timing budgets. `rustc` optimization levels trade between these goals.

### Optimization Profiles

```toml
# Cargo.toml

# Default dev profile — no optimization, good for debugging
[profile.dev]
opt-level = 0

# Release — optimize for speed
[profile.release]
opt-level = 3
debug = true  # debug symbols don't increase Flash size

# Release — optimize for size
[profile.release]
opt-level = "z"  # "s" is slightly less aggressive
```

### Optimize Dependencies Only

Keep your own crate unoptimized (debuggable) while shrinking dependency code:

```toml
# .cargo/config.toml or Cargo.toml
[profile.dev.package."*"]
opt-level = "z"

# Exclude specific crates from size optimization
[profile.dev.package.cortex-m-rt]
opt-level = 0
```

This can reduce Flash usage by several KiB with no loss of top-crate debuggability.

### Optimization Level Summary

| Level | Flag | Effect |
|-------|------|--------|
| 0 | `opt-level = 0` | No optimization; best for debugging |
| 1 | `opt-level = 1` | Basic optimizations |
| 2 | `opt-level = 2` | Loop unrolling, moderate inlining |
| 3 | `opt-level = 3` | Aggressive inlining, vectorization |
| s | `opt-level = "s"` | Optimize for size |
| z | `opt-level = "z"` | Minimize size (lower inline threshold than "s") |

### Inline Threshold Tuning

When `opt-level = "z"` misses zero-cost abstraction opportunities, raise the inline threshold:

```toml
# .cargo/config.toml
[target.'cfg(all(target_arch = "arm", target_os = "none"))']
rustflags = ["-C", "inline-threshold=225"]
```

Default thresholds: `opt-level=3` → 275, `opt-level=2` → 225, `opt-level="s"` → 75, `opt-level="z"` → 25.

## Loop Unrolling

Loop unrolling is applied at `opt-level >= 2`. It halves loop overhead but increases binary size. There is currently no way to disable it selectively at those levels — use `opt-level = 1` or `"s"` if code size is critical.

## Notes

- Enable `debug = true` in `[profile.release]` to get line-level GDB debugging without any Flash overhead
- `codegen-units = 1` in a profile enables whole-crate optimization (LTO-like within a single crate)
- Use `cargo-bloat` to identify which functions consume the most Flash
- Use `-Z emit-stack-sizes` (nightly) to measure stack usage of `heapless` collections

## Related

- [collections.md](./collections.md)
- [no-std.md](./no-std.md)
