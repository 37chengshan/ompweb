# Statements and Expressions

Rust is primarily an **expression language**: most constructs produce values via expressions. Statements sequence expression evaluation.

## Statements

A statement is a component of a block. There are two kinds:

### Declaration Statements

#### Item Declarations

Items (functions, structs, etc.) can be declared inside a block. Their scope is restricted to the block. They cannot capture the enclosing function's generic parameters or local variables.

```rust
fn outer() {
    let x = 1;
    fn inner() { /* x is NOT in scope here */ }
    inner();
}
```

#### Let Statements

```
let [attrs]* <pattern> [: <type>]? [= <initializer>]? [else <block>]? ;
```

- Introduces bindings via a pattern.
- Type annotation is optional (inferred if omitted).
- Without `else`: pattern must be irrefutable.
- With `else`: pattern may be refutable; the `else` block must diverge (return `!`).

```rust
let x = 5;
let (a, b): (i32, i32) = (1, 2);

let Some(t) = v.pop() else {
    panic!("empty!");
};
```

### Expression Statements

An expression followed by `;` (or a block expression without trailing `;`). Evaluates the expression and discards the result.

```rust
v.pop();           // semicolon required for non-block expressions
if v.is_empty() {
    v.push(5);
}                  // semicolon optional for block expressions
```

When a block expression is used as a statement without `;`, its type must be `()`.

---

## Expressions

Expressions produce values and can be nested.

### Expression Categories

**Expressions without a block (`ExpressionWithoutBlock`):**

- Literal, path, operator expressions
- Array, tuple, struct, call, method-call, field, closure, range, await, index, return, break expressions
- Macro invocations

**Expressions with a block (`ExpressionWithBlock`):**

- Block, const block, unsafe block expressions
- Loop, `if`, `match` expressions

### Place vs Value Expressions

**Place expressions** represent memory locations:
- Local variables, `static` variables
- Dereferences: `*expr`
- Array indexing: `expr[i]`
- Field access: `expr.field`
- Parenthesized place expressions

**Value expressions** produce values. When a value expression appears in a place context, a temporary is created.

### Operator Precedence (highest to lowest)

| Operator / Expression | Associativity |
|-----------------------|---------------|
| Paths, method calls, field access | left |
| Function calls, array indexing | — |
| `?` | — |
| Unary: `-`, `!`, `*`, `&`, `&mut` | — |
| `as` | left |
| `*`, `/`, `%` | left |
| `+`, `-` | left |
| `<<`, `>>` | left |
| `&` (bitwise AND) | left |
| `^` (bitwise XOR) | left |
| `\|` (bitwise OR) | left |
| `==`, `!=`, `<`, `>`, `<=`, `>=` | requires parentheses |
| `&&` | left |
| `\|\|` | left |
| `..`, `..=` | requires parentheses |
| `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=` | right |
| `return`, `break`, closures | — |

### Evaluation Order

Operands are evaluated **left to right** before the expression takes effect. Assignment right-hand sides are evaluated before the left-hand side is assigned.

### Move and Copy Semantics

When a place expression is used in a value context:
- If the type is `Copy`: the value is copied.
- If the type is `Sized` but not `Copy`: the value may be moved; the source is deinitialized.

### Mutability

An expression can be mutably borrowed/assigned only if it is a **mutable place expression**:
- Mutable variables not currently borrowed
- Mutable `static` items
- `*mut T` dereferences
- `&mut T` dereferences

### Temporaries

Value expressions used in place contexts create unnamed temporary values, dropped at the end of the enclosing statement (unless promoted to `'static`).

### Implicit Borrows

Several expressions implicitly borrow their operands:
- Method call left operand
- Field expression left operand
- Array index left operand
- Dereference operand
- Compound assignment left operand
- Comparison operators (both operands)
- `format_args!` arguments

### Common Expression Types

```rust
// Block
let x = { let a = 1; a + 2 };

// If
let y = if condition { 1 } else { 2 };

// Match
match x {
    0 => "zero",
    1..=9 => "single digit",
    _ => "other",
}

// Loop with break value
let z = loop {
    if done { break 42; }
};

// Closure
let add = |a: i32, b: i32| a + b;

// Range
let r = 0..10;
let ri = 0..=9;

// Return / break / continue
fn f() -> i32 { return 0; }
```

## Notes

- Statements accept outer `cfg` and lint attributes.
- `ExpressionWithBlock` as a statement must have type `()` or be followed by `;`.
- The `format_args!` and `pin!` macros extend the lifetime of their temporary arguments beyond the statement.

## Related

- [patterns.md](./patterns.md)
- [type-system.md](./type-system.md)
- [items.md](./items.md)
