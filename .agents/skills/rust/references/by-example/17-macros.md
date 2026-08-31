# macro_rules!

Macros are metaprogramming constructs that expand into Rust code at compile time. `macro_rules!` defines **declarative macros** using pattern matching on syntax trees (not string replacement).

## Basic Definition

```rust
macro_rules! say_hello {
    () => {
        println!("Hello!")
    };
}

fn main() {
    say_hello!(); // expands to println!("Hello!")
}
```

## Designators (Pattern Matchers)

| Designator | Matches |
|------------|---------|
| `expr` | expressions |
| `stmt` | statements |
| `ty` | types |
| `ident` | identifiers |
| `path` | module paths |
| `tt` | token tree |
| `literal` | literal values |
| `item` | items (fn, struct, etc.) |
| `block` | blocks `{}` |
| `meta` | attribute metadata |

```rust
macro_rules! create_fn {
    ($func_name:ident) => {
        fn $func_name() {
            println!("function: {:?}", stringify!($func_name));
        }
    };
}

create_fn!(foo);
create_fn!(bar);

fn main() {
    foo(); // function: "foo"
    bar(); // function: "bar"
}
```

## Overloading (Multiple Arms)

```rust
macro_rules! test {
    ($left:expr; and $right:expr) => {
        println!("{} AND {}", $left, $right);
    };
    ($left:expr; or $right:expr) => {
        println!("{} OR {}", $left, $right);
    };
}

fn main() {
    test!(1 + 1 == 2; and 2 + 2 == 4);
    test!(true; or false);
}
```

## Repetition

Use `$(...)*` (zero or more) or `$(...)+` (one or more):

```rust
macro_rules! vec_of_strings {
    ($($x:expr),*) => {
        vec![$($x.to_string()),*]
    };
}

fn main() {
    let v = vec_of_strings!["hello", "world"];
}
```

## Use Cases

- **DRY**: avoid duplicating logic for different types.
- **DSL**: build mini-languages (e.g., `html! {}` in Yew).
- **Variadic**: accept variable number of arguments (like `println!`, `vec!`).

## Notes

- Macro names end with `!` at call sites.
- Macros expand before type checking; errors can be hard to diagnose.
- Procedural macros (`#[derive(...)]`, attribute macros, function-like macros) offer more power but require a separate crate with `proc-macro = true`.
- Use `macro_export` to make a macro available outside its defining crate.

## Related

- [13-attributes.md](./13-attributes.md)
- [09-functions.md](./09-functions.md)
