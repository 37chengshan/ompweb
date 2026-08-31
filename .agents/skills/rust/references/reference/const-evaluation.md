# Constant Evaluation

Constant evaluation is the process of computing values of expressions at compile time. This enables zero-cost abstractions such as compile-time array sizes, type-level integers, and pre-computed lookup tables.

## Const Contexts

An expression is evaluated at compile time when it appears in a **const context**:

1. Array length expressions: `[T; N]`
2. Array repeat expressions: `[expr; N]`
3. Initializers of `const`, `static`, or enum discriminants
4. Const generic arguments
5. Explicit `const { }` blocks

## Const Functions (`const fn`)

A function callable from a const context:

```rust
const fn square(x: i32) -> i32 { x * x }

const AREA: i32 = square(12);  // evaluated at compile time
```

- In a const context: the compiler evaluates the function at compile time (in the **target** environment, not the host).
- Outside a const context: behaves like a regular function, called at runtime.
- **Cannot** be `async`.
- Body may only use expressions that are valid in const contexts.

Tuple struct constructors and enum variant constructors also count as `const fn`.

## Allowed Constant Expressions

The following are valid constant expressions (provided operands are also constant and no destructors are run):

| Category | Examples |
|----------|---------|
| Literals and const parameters | `42`, `"hello"`, `N` |
| Paths to functions and constants | `foo`, `std::i32::MAX` |
| Paths to statics (with restrictions) | `&STATIC` (no writes, no reads from mutable/extern statics) |
| Tuple, array, struct expressions | `(1, 2)`, `[0u8; 16]`, `Point { x: 0, y: 0 }` |
| Block expressions | `{ let x = 1; x + 2 }` |
| Field and index expressions | `pair.0`, `arr[0]` (index must be `usize`) |
| Range expressions | `0..10` |
| Non-capturing closures | `\|x: i32\| x * 2` |
| Built-in operators | arithmetic, logical, comparison, lazy boolean |
| Borrows | `&expr` (with restrictions on mutable/interior-mutable temporaries) |
| Dereferences | `*ptr` (including unsafe pointer dereferences) |
| Cast expressions | `x as u64` (except pointer-to-address, fn-ptr-to-address) |
| Const function calls | `const_fn(args)` |
| Loop, conditional expressions | `loop { break 1; }`, `if cond { a } else { b }`, `match` |

## Borrow Restrictions

In const contexts, mutable borrows and shared borrows of interior-mutable data are only allowed when borrowing:
- **Transient** places (local variables or temporaries within the const context)
- **Indirect** places (dereference expressions)
- **Static** items

## Errors vs Warnings

| Situation | In const context | Outside const context |
|-----------|-----------------|----------------------|
| Out-of-bounds array index | **Compile error** | Runtime panic (warning) |
| Integer overflow | **Compile error** | Runtime panic (debug) or wrap (release) |

## Generic Parameter Restrictions

Array lengths, repeat counts, and const generic arguments can only use outer generic parameters if the expression is a single const generic parameter, not an arbitrary expression involving generics.

```rust
fn make_array<const N: usize>() -> [u8; N] { [0; N] }  // OK

// NOT allowed without feature(generic_const_exprs):
// fn double<const N: usize>() -> [u8; N * 2] { ... }
```

## Const Generics

Types can be parameterized by constant values:

```rust
struct Matrix<const ROWS: usize, const COLS: usize> {
    data: [[f64; COLS]; ROWS],
}

fn identity<const N: usize>() -> Matrix<N, N> {
    // ...
}
```

Supported types for const generic parameters: integers, `bool`, `char`. (More types may be supported with `feature(adt_const_params)`.)

## Notes

- Const evaluation uses the **target** compilation environment (byte order, pointer width), not the host.
- `Drop::drop` is never called in const contexts — values that require dropping cannot be used in most const expressions.
- Floating-point operations in const contexts may produce different results than at runtime if the host and target differ (use with caution).

## Related

- [type-system.md](./type-system.md)
- [items.md](./items.md)
- [behavior-considered-undefined.md](./behavior-considered-undefined.md)
