# Patterns

Patterns match values against structures and optionally bind variables. Used in `let`, function parameters, `match`, `if let`, `while let`, and `for`.

## Grammar

```
Pattern → |? PatternNoTopAlt ( | PatternNoTopAlt )*

PatternNoTopAlt →
    LiteralPattern
  | IdentifierPattern
  | WildcardPattern
  | RestPattern
  | RangePattern
  | ReferencePattern
  | StructPattern
  | TupleStructPattern
  | TuplePattern
  | GroupedPattern
  | SlicePattern
  | PathPattern
  | MacroInvocation
```

## Pattern Types

### Literal Patterns

Match exact values. Always **refutable**.

```rust
match x {
    -1 => "minus one",
    1  => "one",
    2 | 4 => "two or four",
    _ => "other",
}
```

### Identifier Patterns

Bind a value to a name. **Irrefutable** unless an `@` subpattern is refutable.

```rust
let x = 5;                      // simple binding
match x {
    e @ 1..=5 => println!("{}", e),  // @ binding
    _ => {}
}
```

`ref` and `ref mut` bind by reference instead of by value:

```rust
match some_string {
    Some(ref s) => println!("{}", s),
    None => {}
}
```

**Binding modes**: When matching `&T` or `&mut T`, the compiler automatically inserts `ref`/`ref mut` for ergonomics.

### Wildcard Pattern (`_`)

Matches any value without binding or moving it. Always **irrefutable**.

```rust
let (a, _) = (1, 2);
if let Some(_) = x {}
```

### Rest Pattern (`..`)

Matches zero or more remaining elements. Always **irrefutable**. Allowed once per tuple/struct/slice pattern.

```rust
match tuple {
    (1, .., last) => println!("{}", last),
    (..) => {}
}

match &words[..] {
    [head, tail @ ..] => println!("{:?} {:?}", head, tail),
    [] => {}
}
```

### Range Patterns

Match scalar values within bounds. Endpoints must be constants of `char`, integer, or float type.

```rust
match ph {
    0..7   => "acid",    // exclusive end (not including 7)
    7      => "neutral",
    8..=14 => "base",    // inclusive end
    _ => unreachable!(),
}
```

Forms: `a..b`, `a..=b`, `a..` (from), `..b` (to exclusive), `..=b` (to inclusive).

Float range patterns cannot include `NaN`.

### Reference Patterns

Dereference a pointer; bind through the pointer.

```rust
let &x = &5;    // x: i32 = 5
match &val {
    &0 => "zero",
    _ => "other",
}
```

### Struct Patterns

Destructure structs, enums with named fields, and unions.

```rust
let Point { x, y } = p;            // shorthand
let Point { x: a, y: b } = p;      // renamed

match s {
    Point { x: 0, .. } => "on y-axis",
    Point { x, y } => println!("{} {}", x, y),
}
```

Union patterns must name exactly one field.

### Tuple Struct Patterns

Match tuple structs and enum variants with positional fields.

```rust
match message {
    Message::Quit => {},
    Message::Move { x, y } => {},
    Message::Write(text) => println!("{}", text),
    Message::ChangeColor(r, g, b) => {},
}
```

### Tuple Patterns

Match tuples.

```rust
let (a, b, c) = (1, 2, 3);
let (..) = ();   // matches any tuple
```

### Grouped Patterns

Parentheses for disambiguation (e.g., reference + range):

```rust
match int_ref {
    &(0..=5) => "low",
    _ => "other",
}
```

### Slice Patterns

Match arrays (fixed size) and slices (dynamic size).

```rust
// Fixed-size array
match [1, 2, 3] {
    [1, _, _] => "starts with 1",
    [a, b, c] => println!("{} {} {}", a, b, c),
}

// Dynamic slice
match v[..] {
    [a, b] => {},
    [a, b, c] => {},
    _ => {}
}

// Rest in slice
match &words[..] {
    [.., "!"] => println!("ends with !"),
    _ => {}
}
```

### Path Patterns

Match constants, unit structs, or unit enum variants.

```rust
const ANSWER: u8 = 42;

match x {
    ANSWER => println!("the answer"),
    _ => {}
}
```

Constants used in patterns must implement `PartialEq` and have structural equality.

### Or-Patterns

Match one of several alternatives. Bindings must be identical in all alternatives.

```rust
match x {
    1 | 2 | 3 => println!("small"),
    _ => {}
}
```

Not allowed at the top level in `let` bindings or function/closure parameters.

---

## Destructuring

```rust
struct Person { name: String, age: u8 }

if let Person { name: ref n, age: teen @ 13..=19, .. } = person {
    println!("{} is a teenager", n);
}
```

---

## Refutability

**Irrefutable** (always match): wildcard `_`, rest `..`, identifier patterns without `@`, tuple/array patterns with all-irrefutable subpatterns, reference patterns, range patterns spanning the entire type.

**Refutable** (may not match): literals, most range patterns, struct/tuple struct patterns for multi-variant enums, path patterns for multi-variant enums.

| Context | Allowed patterns |
|---------|-----------------|
| `let` statement | Irrefutable only (or with `else` diverge block) |
| Function/closure parameters | Irrefutable only |
| `match` arms | Any (refutable or irrefutable) |
| `if let` / `while let` | Refutable |
| `for` | Irrefutable |

## Related

- [statements-and-expressions.md](./statements-and-expressions.md)
- [type-system.md](./type-system.md)
