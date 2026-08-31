# Conditional Compilation

Source code can be conditionally compiled based on configuration predicates using `#[cfg]`, `#[cfg_attr]`, `cfg!()`, and `cfg_select!`.

## Configuration Predicates

| Form | Meaning |
|------|---------|
| `identifier` | True if the option is set (e.g., `unix`) |
| `key = "value"` | True if the key has this value (e.g., `target_os = "linux"`) |
| `all(pred, ...)` | True if all predicates are true (empty = true) |
| `any(pred, ...)` | True if any predicate is true (empty = false) |
| `not(pred)` | True if predicate is false |
| `true` / `false` | Literal boolean |

## `#[cfg]` Attribute

Conditionally includes the following item:

```rust
#[cfg(target_os = "macos")]
fn macos_only() {}

#[cfg(any(foo, bar))]
fn needs_foo_or_bar() {}

#[cfg(all(unix, target_pointer_width = "32"))]
fn on_32bit_unix() {}

#[cfg(not(foo))]
fn needs_not_foo() {}

#[cfg(panic = "unwind")]
fn when_unwinding() {}
```

## `cfg!()` Macro

Evaluates a predicate at compile time to a `bool` literal:

```rust
let machine_kind = if cfg!(unix) {
    "unix"
} else if cfg!(windows) {
    "windows"
} else {
    "unknown"
};
```

## `#[cfg_attr]` Attribute

Conditionally applies other attributes:

```rust
#[cfg_attr(target_os = "linux", path = "linux.rs")]
#[cfg_attr(windows, path = "windows.rs")]
mod os;

// Multiple attributes can be expanded
#[cfg_attr(feature = "magic", sparkles, crackles)]
fn bewitched() {}
```

## `cfg_select!` Macro

Selects code from multiple arms; expands to the first arm whose predicate is true. `_` is a wildcard that always matches:

```rust
cfg_select! {
    unix => {
        fn foo() { /* unix */ }
    }
    target_pointer_width = "32" => {
        fn foo() { /* non-unix 32-bit */ }
    }
    _ => {
        fn foo() { /* fallback */ }
    }
}
```

## Compiler-Set Configuration Options

| Key | Example Values |
|-----|---------------|
| `target_arch` | `"x86_64"`, `"aarch64"`, `"arm"`, `"wasm32"` |
| `target_os` | `"linux"`, `"macos"`, `"windows"`, `"none"` |
| `target_family` | `"unix"`, `"windows"`, `"wasm"` |
| `target_env` | `"gnu"`, `"msvc"`, `"musl"` |
| `target_abi` | `"eabihf"`, `"abi64"` |
| `target_endian` | `"little"`, `"big"` |
| `target_pointer_width` | `"32"`, `"64"` |
| `target_vendor` | `"apple"`, `"pc"`, `"unknown"` |
| `target_has_atomic` | `"8"`, `"16"`, `"32"`, `"64"`, `"ptr"` |
| `target_feature` | `"avx"`, `"sse2"`, `"neon"` |
| `test` | Set when compiling the test harness |
| `debug_assertions` | Set without optimizations |
| `proc_macro` | Set for proc-macro crate types |
| `panic` | `"abort"` or `"unwind"` |

Shorthand predicates: `unix` = `target_family = "unix"`, `windows` = `target_family = "windows"`.

## Arbitrarily-Set Options

Set via compiler flags or Cargo features:

```sh
rustc --cfg foo --cfg 'target_arch="x86_64"'
```

Cargo sets `feature = "..."` options for each enabled feature.

## Notes

- Items excluded by `#[cfg]` are not parsed for name resolution, so references inside them may be invalid.
- `#[cfg_attr]` can be nested: the inner attributes are themselves processed for `cfg`.

## Related

- [attributes.md](./attributes.md)
- [items.md](./items.md)
