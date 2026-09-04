# Macros

Macros extend Rust's syntax and functionality. They are invoked with the `!` sigil and can expand to expressions, statements, patterns, types, or items.

## Invocation Syntax

```
SimplePath ! DelimTokenTree
```

The delimiter can be `()`, `[]`, or `{}`:

```rust
vec![1, 2, 3]
println!("Hello!")
thread_local!{ static FOO: RefCell<u32> = RefCell::new(1); }
```

## Two Kinds of Macros

1. **Macros by Example** (`macro_rules!`) — declarative, pattern-based
2. **Procedural Macros** — function-like, derive, or attribute macros written as Rust functions

---

## Macros by Example (`macro_rules!`)

```rust
macro_rules! name {
    matcher => transcriber;
    // more rules ...
}
```

### Fragment Specifiers

| Specifier | Matches |
|-----------|---------|
| `block` | Block expression |
| `expr` | Expression |
| `ident` | Identifier or keyword |
| `item` | Item definition |
| `lifetime` | Lifetime token |
| `literal` | Literal value |
| `meta` | Attribute contents |
| `pat` | Pattern |
| `pat_param` | Pattern without top-level or |
| `path` | Type path |
| `stmt` | Statement |
| `tt` | Token tree (single token or delimited group) |
| `ty` | Type |
| `vis` | Visibility qualifier |

### Metavariables

```rust
macro_rules! my_macro {
    ($x:expr) => { println!("{}", $x); };
}
```

`$crate` refers to the crate where the macro is defined (for cross-crate hygiene).

### Repetitions

```rust
$( pattern )*   // 0 or more
$( pattern )+   // 1 or more
$( pattern )?   // 0 or 1 (no separator)
```

```rust
macro_rules! vec_macro {
    ( $( $x:expr ),* ) => {{
        let mut v = Vec::new();
        $( v.push($x); )*
        v
    }};
}

let v = vec_macro![1, 2, 3];
```

Metavariables must appear in exactly the same repetition nesting in the transcriber as in the matcher. Multiple metavariables in the same repetition must bind equal numbers of fragments.

### Hygiene (Mixed-Site)

- **Definition site**: loop labels, block labels, local variables
- **Invocation site**: other symbols (functions, types, etc.)

Variables defined inside a macro are not visible at the invocation site, and vice versa.

### Scoping and Export

- **Textual scope** (default): macro is in scope from its definition to the end of the module.
- **`#[macro_use]`** on a module: extends scope past module boundaries.
- **`#[macro_export]`**: makes the macro `pub` and available for path-based lookup (`crate::my_macro!()`).

```rust
#[macro_export]
macro_rules! exported_macro {
    () => { println!("exported!"); }
}
```

### Follow-Set Restrictions

Certain fragment types constrain what tokens may follow them to avoid ambiguity:

| Fragment | Must be followed by |
|----------|---------------------|
| `expr`, `stmt` | `=>`, `,`, `;` |
| `pat` | `=>`, `,`, `=`, `if`, `in` |
| `path`, `ty` | `=>`, `,`, `;`, `\|`, `=`, `:`, `>`, `[`, `{`, `as`, `where`, or block metavar |

---

## Procedural Macros

Defined in a dedicated **proc-macro crate** (`[lib] proc-macro = true`). Cannot be used in the same crate where they are defined.

### 1. Function-like (`#[proc_macro]`)

```rust
use proc_macro::TokenStream;

#[proc_macro]
pub fn make_answer(_item: TokenStream) -> TokenStream {
    "fn answer() -> u32 { 42 }".parse().unwrap()
}
```

Usage: `make_answer!()`

### 2. Derive Macros (`#[proc_macro_derive]`)

```rust
#[proc_macro_derive(MyDerive)]
pub fn derive_my(item: TokenStream) -> TokenStream {
    // generate impl ...
    TokenStream::new()
}
```

Usage: `#[derive(MyDerive)]`

Can also declare **helper attributes**:

```rust
#[proc_macro_derive(MyDerive, attributes(helper))]
pub fn derive_my(item: TokenStream) -> TokenStream { ... }
```

### 3. Attribute Macros (`#[proc_macro_attribute]`)

```rust
#[proc_macro_attribute]
pub fn route(attr: TokenStream, item: TokenStream) -> TokenStream {
    // attr = attribute arguments, item = the annotated item
    item
}
```

Usage: `#[route(GET, "/")]`

### TokenStream

`proc_macro::TokenStream` is roughly `Vec<TokenTree>` where `TokenTree` is one of:
- `Ident` — identifier
- `Punct` — punctuation
- `Literal` — literal
- `Group` — `(...)`, `[...]`, or `{...}`

Each token carries an opaque `Span` used for error reporting.

### Hygiene

Procedural macros are **unhygienic**: output tokens are treated as if written inline. Use absolute paths (`::std::option::Option`) and unlikely generated names to avoid conflicts.

### Error Reporting

- `panic!()` — caught by the compiler and turned into a compile error
- `compile_error!("message")` — explicit error at a given span

---

## Notes

- Macros can be invoked in expressions, statements, patterns, types, and item positions.
- `macro_rules!` uses **textual scoping** by default; lookup order: textual scope first, then path-based scope.
- Procedural macros always use path-based scope.

## Related

- [items.md](./items.md)
- [attributes.md](./attributes.md)
