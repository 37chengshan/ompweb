# Attributes

Attributes are general metadata applied to items, expressions, and other language constructs, modeled on ECMA-335.

## Syntax

```
Attr → SimplePath AttrInput?
     | unsafe ( SimplePath AttrInput? )

AttrInput → DelimTokenTree | = Expression
```

**Outer attribute** (applies to the following form):
```rust
#[attr]
```

**Inner attribute** (applies to the enclosing form):
```rust
#![attr]
```

## Inner vs Outer Examples

```rust
#![crate_type = "lib"]          // inner: applies to the crate

#[test]
fn test_foo() {}                 // outer: applies to the function

fn some_fn() {
    #![allow(unused_variables)] // inner: applies to the function
    let x = ();
}
```

## Meta Item Syntax

| Style | Example |
|-------|---------|
| `MetaWord` | `#[no_std]` |
| `MetaNameValueStr` | `#[doc = "example"]` |
| `MetaListPaths` | `#[allow(unused, clippy::inline_always)]` |
| `MetaListIdents` | `#[macro_use(foo, bar)]` |
| `MetaListNameValueStr` | `#[link(name = "CoreFoundation", kind = "framework")]` |

## Unsafe Attributes

Some attributes with safety implications must be wrapped in `unsafe(...)`:

```rust
#[unsafe(no_mangle)]
pub fn exported() {}

#[unsafe(export_name = "my_sym")]
pub fn renamed() {}
```

Unsafe attributes: `export_name`, `link_section`, `naked`, `no_mangle`.

## Built-in Attributes Index

### Conditional Compilation
- **`cfg`** — conditionally include code
- **`cfg_attr`** — conditionally apply attributes

### Testing
- **`test`** — mark a function as a test
- **`ignore`** — disable a test
- **`should_panic`** — test is expected to panic

### Derive
- **`derive`** — automatic trait implementations
- **`automatically_derived`** — marker on derive-generated impls

### Macros
- **`macro_export`** — export `macro_rules!` for cross-crate use
- **`macro_use`** — expand macro visibility beyond module boundary
- **`proc_macro`**, **`proc_macro_derive`**, **`proc_macro_attribute`** — define procedural macros

### Diagnostics
- **`allow`**, **`warn`**, **`deny`**, **`forbid`** — alter lint levels
- **`expect`** — expect a lint to trigger (error if it doesn't)
- **`deprecated`** — emit deprecation notice
- **`must_use`** — lint for unused return values
- **`diagnostic::on_unimplemented`** — custom error message when trait not implemented
- **`diagnostic::do_not_recommend`** — hide impl from trait solver error output

### ABI, Linking, Symbols, FFI
- **`link`** — specify a native library to link
- **`link_name`** — override FFI symbol name
- **`link_ordinal`** — symbol ordinal (Windows DLL)
- **`no_link`** — don't link the `extern crate`
- **`repr`** — control type layout/ABI
- **`crate_type`** — specify crate output type
- **`no_main`** — suppress `main` symbol emission
- **`export_name`** *(unsafe)* — exported symbol name
- **`link_section`** *(unsafe)* — object file section placement
- **`no_mangle`** *(unsafe)* — disable symbol name mangling
- **`used`** — keep static in output object file
- **`crate_name`** — specify crate name

### Code Generation
- **`inline`** — hint to inline the function
- **`cold`** — hint that the function is rarely called
- **`naked`** *(unsafe)* — suppress function prologue/epilogue
- **`no_builtins`** — disable certain built-in function substitutions
- **`target_feature`** — enable target CPU features for a function
- **`track_caller`** — pass parent call location via `Location::caller()`
- **`instruction_set`** — select instruction set (ARM Thumb/A32)

### Documentation
- **`doc`** — attach documentation (see rustdoc)

### Preludes
- **`no_std`** — remove `std` from the prelude
- **`no_implicit_prelude`** — disable prelude lookup in this module

### Modules
- **`path`** — override the filename for a file-based module

### Limits
- **`recursion_limit`** — maximum macro/recursion depth (default 128)
- **`type_length_limit`** — maximum length of monomorphized types

### Runtime
- **`panic_handler`** — designate the panic handling function
- **`global_allocator`** — designate the global memory allocator
- **`windows_subsystem`** — Windows subsystem (`"console"` or `"windows"`)

### Features
- **`feature`** — enable unstable/nightly features

### Type System
- **`non_exhaustive`** — indicate a type may have more variants/fields in future

### Debugger
- **`debugger_visualizer`** — embed debugger visualizer (e.g., Natvis)
- **`collapse_debuginfo`** — control macro expansion in debug info

## Tool Attributes

External tools register their own attribute namespaces:

```rust
#[rustfmt::skip]
struct Ugly { a:i32,b:i32 }

#[clippy::cyclomatic_complexity = "100"]
pub fn complex() {}
```

Recognized tool namespaces: `clippy`, `rustfmt`, `diagnostic`, `miri`, `rust_analyzer`.

## Active vs Inert Attributes

- **Active**: Consumed during processing — `cfg`, `cfg_attr`, attribute macros.
- **Inert**: Remain on the item — most built-in attributes, derive helper attributes.

## Notes

- Inner attributes are only allowed in specific positions: crate root, module bodies, block expressions, function bodies, `extern` blocks, and inside `impl`/`trait`.
- Attributes on generic parameters and function parameters are supported in limited contexts.

## Related

- [conditional-compilation.md](./conditional-compilation.md)
- [macros.md](./macros.md)
- [items.md](./items.md)
- [abi.md](./abi.md)
