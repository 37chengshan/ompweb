# Names, Scopes, Paths, and Namespaces

## Core Concepts

- **Entity**: Any language construct that can be referred to — types, items, generic parameters, variable bindings, loop labels, lifetimes, fields, attributes, lints.
- **Declaration**: Introduces a name binding for an entity.
- **Scope**: The region of source text where a name may be referenced.
- **Namespace**: Separate partitions of the name space that allow the same name to refer to different entities in different contexts.
- **Path**: A sequence of path segments used to refer to an entity, possibly in another module.
- **Name resolution**: The compile-time process of mapping paths and identifiers to declarations.
- **Visibility**: Access control determining which modules can refer to a name.

---

## Explicitly Declared Entities

Items introduce names via: modules, `extern crate`, `use`, functions (including parameters), type aliases, structs, unions, enums (variants and fields), constants, statics, traits, associated items, `extern` block items, `macro_rules!` definitions, and implementation associated items.

Expressions introduce names via: closure parameters, pattern bindings in `let`, `if let`, `while let`, `for`, `match`, and loop labels.

---

## Implicitly Declared Entities

The **language prelude** always provides: `bool`, `char`, `str`, all integer types (`i8`–`i128`, `u8`–`u128`, `isize`, `usize`), `f32`, `f64`.

Additional prelude items come from the standard library and (if applicable) `extern crate` declarations added by the compiler.

---

## Namespaces

Names are partitioned into namespaces so the same identifier can refer to different things without conflict. Key namespaces:

- **Type namespace**: types, traits, type aliases, modules, enum variants (used as types)
- **Value namespace**: functions, constants, statics, variables, enum variants (used as values)
- **Macro namespace**: `macro_rules!` definitions and procedural macros
- **Lifetime/label namespace**: lifetime parameters, loop labels

---

## Scopes

### Item Scopes

- Module-level items are in scope from the **start of the module to the end**.
- Block-declared items are in scope from the **start of the block to the end**.
- Items may shadow prelude names.
- Items from outer modules are **not** automatically in scope in nested modules — use paths.
- Duplicate item names in the same namespace in the same module/block are errors.

### Pattern Binding Scopes

| Context | Scope |
|---------|-------|
| `let` statement | From just after the statement to end of block |
| Function/closure parameters | Within the body |
| `for` loop | Within the loop body |
| `if let` / `while let` | In following conditions and the block |
| `match` arm | Within the guard and arm expression |

Pattern bindings can shadow most names, but **not** const generic parameters, static items, const items, or enum/struct constructors.

### Generic Parameter Scopes

- In scope within the item they are declared on.
- All parameters are in scope within the generic parameter list regardless of order.
- Inner functions cannot use generic parameters from an outer function.
- Shadowing generic parameters is an error (except inside functions nested within functions).

### Lifetime Scopes

- `'static` is a reserved keyword; it cannot be declared as a user parameter.
- `'_` (placeholder) cannot be declared as a parameter.
- In `const`/`static` contexts only `'static` lifetimes may be referenced.
- Higher-ranked trait bounds (`for<'a>`) introduce lifetimes scoped to the bound.

### Loop Label Scopes

- Loop labels are in scope from declaration to the end of the loop expression.
- Scope does **not** extend into nested items, closures, async blocks, const arguments, or the iterator expression of a `for` loop.
- Labels may shadow outer labels; `break 'label` targets the innermost matching label.

### Prelude Scopes (layered, highest priority first)

1. Extern prelude (compiler-provided crates)
2. Tool prelude
3. `macro_use` prelude
4. Standard library prelude
5. Language prelude

---

## Paths

Paths identify items and values by name, optionally with module qualifiers:

```rust
std::collections::HashMap
crate::utils::helper
self::inner
super::parent_fn
::absolute_path   // rare; anchors to crate root
```

**Qualified paths** for trait disambiguation:

```rust
<Type as Trait>::method()
<Vec<i32> as IntoIterator>::IntoIter
```

**Generic arguments** in paths:

```rust
Vec::<i32>::new()
std::mem::size_of::<u32>()
```

---

## Visibility

```rust
pub fn public() {}                    // visible everywhere
pub(crate) fn crate_visible() {}      // visible in this crate
pub(super) fn parent_visible() {}     // visible in parent module
pub(in crate::module) fn path_vis() {} // visible in specified path
fn private() {}                       // visible only in this module (default)
```

A name is accessible if all modules on its path to the use site are also accessible.

---

## Name Resolution Order (unqualified)

1. Local bindings (most recent `let` in scope)
2. Item names in the current module
3. Prelude names

For macros:
1. Textual scope (innermost `macro_rules!` definition)
2. Path-based scope (`macro_export` or re-exported macros)

---

## Notes

- `Self` in a type context refers to the type being implemented/defined.
- `Self` in a value context refers to the constructor of the type.
- Derive macro helper attributes shadow other attributes with the same name from their position to the end of the item.

## Related

- [items.md](./items.md)
- [macros.md](./macros.md)
- [patterns.md](./patterns.md)
