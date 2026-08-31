# Lexical Structure

Covers the input format, tokenization rules, identifiers, keywords, literals, comments, and whitespace used in Rust source files.

## Input Format

### Source Processing Pipeline

1. **Encoding**: Source files must be UTF-8. Non-UTF-8 input is a compile error.
2. **BOM removal**: A leading `U+FEFF` (byte order mark) is stripped.
3. **CRLF normalization**: Each `\r\n` pair is replaced with `\n` (single pass).
4. **Shebang removal**: If the file starts with `#!` (not followed by `[`), the first line is stripped.

```rust
#!/usr/bin/env rustx
fn main() { println!("Hello!"); }
```

`include!` applies these transformations; `include_str!` and `include_bytes!` do **not**.

## Tokens

Tokens fall into six categories: **keywords**, **identifiers**, **literals**, **lifetimes**, **punctuation**, and **delimiters**.

### Literals

| Kind | Example | Notes |
|------|---------|-------|
| Character | `'H'` | All Unicode, with escapes |
| String | `"hello"` | All Unicode, with escapes |
| Raw string | `r#"hello"#` | No escapes; `#` count must match |
| Byte | `b'H'` | ASCII only |
| Byte string | `b"hello"` | ASCII only |
| Raw byte string | `br#"hello"#` | ASCII only, no escapes |
| C string | `c"hello"` | Unicode, NUL-terminated |
| Raw C string | `cr#"hello"#` | No escapes |

**Escape sequences:**
- `\n`, `\r`, `\t`, `\\`, `\0` — common ASCII
- `\x41` — 7-bit hex (ASCII), `\xNN` — byte hex
- `\u{7FFF}` — Unicode scalar (up to 6 hex digits)
- `\'`, `\"` — quote escapes

### Integer Literals

```rust
98_222      // decimal
0xff        // hexadecimal
0o77        // octal
0b1111_0000 // binary
123u32      // with type suffix
```

Valid suffixes: `u8`, `u16`, `u32`, `u64`, `u128`, `usize`, `i8`, `i16`, `i32`, `i64`, `i128`, `isize`.

### Floating-Point Literals

```rust
123.0f64
0.1f32
12E+99_f64
let x: f64 = 2.;  // trailing dot; no suffix allowed
```

Valid suffixes: `f32`, `f64`.

### Literal Suffixes

Any literal with any suffix is a valid token for macros. In expressions, only numeric literals accept type suffixes; non-numeric literals may not have suffixes.

## Identifiers

```
IDENTIFIER_OR_KEYWORD → (XID_Start | _) XID_Continue*
RAW_IDENTIFIER        → r# IDENTIFIER_OR_KEYWORD
IDENTIFIER            → NON_KEYWORD_IDENTIFIER | RAW_IDENTIFIER
```

- Follow Unicode Standard Annex #31 (Unicode 17.0).
- Raw identifiers (`r#let`, `r#type`) allow using strict/reserved keywords as names.
- Cannot be `r#_`, `r#crate`, `r#self`, `r#Self`, `r#super`.
- Non-ASCII characters are prohibited in `extern crate` names, filesystem module names, and `#[no_mangle]` items.
- Identifiers are NFC-normalized; two identifiers are equal if their NFC forms match.

```rust
let r#let = 5;       // raw identifier, uses keyword "let"
let Москва = "city"; // non-ASCII identifier
```

## Keywords

### Strict Keywords (cannot be used as identifiers)

`as`, `async`, `await`, `break`, `const`, `continue`, `crate`, `dyn`, `else`, `enum`,
`extern`, `false`, `fn`, `for`, `if`, `impl`, `in`, `let`, `loop`, `match`, `mod`,
`move`, `mut`, `pub`, `ref`, `return`, `self`, `Self`, `static`, `struct`, `super`,
`trait`, `true`, `type`, `unsafe`, `use`, `where`, `while`, `_`

*2018 edition added:* `async`, `await`, `dyn`

### Reserved Keywords (not yet used, reserved for future use)

`abstract`, `become`, `box`, `do`, `final`, `gen`, `macro`, `override`, `priv`, `try`,
`typeof`, `unsized`, `virtual`, `yield`

*2024 edition added:* `gen`

### Weak Keywords (special meaning only in certain contexts)

- `'static` — static lifetime
- `macro_rules` — declarative macro definition
- `raw` — raw borrow operators (`&raw const`, `&raw mut`)
- `safe` — marks items in `extern` blocks as safe
- `union` — declares a union type

## Lifetimes and Loop Labels

```
'lifetime
'r#keyword  // raw lifetime (2021+ edition)
```

Raw lifetimes allow using reserved keywords (except `_`, `crate`, `self`, `Self`, `super`) as lifetime names:

```rust
fn foo<'r#type>() {}
```

## Comments

| Syntax | Kind | Equivalent attribute |
|--------|------|----------------------|
| `//` | Line comment | (whitespace) |
| `/* … */` | Block comment (nestable) | (whitespace) |
| `///` | Outer doc comment | `#[doc="..."]` |
| `/** … */` | Outer block doc comment | `#[doc="..."]` |
| `//!` | Inner doc comment | `#![doc="..."]` |
| `/*! … */` | Inner block doc comment | `#![doc="..."]` |

Block comments support nesting. CR (`\r`) is not allowed in doc comments.

```rust
//! Crate-level docs
pub mod parser {
    /// Documents the next item
    pub fn parse() {}
}
```

## Whitespace

Whitespace has no semantic significance — it only separates tokens. Any `Pattern_White_Space` Unicode character is valid whitespace:

`\t` (U+0009), `\n` (U+000A), `\r` (U+000D), `' '` (U+0020), and several others including U+0085, U+200E, U+200F, U+2028, U+2029.

## Edition Notes

- **2021**: C string literals, raw C strings, raw lifetimes introduced; reserved prefixes (e.g., `a#foo`) become errors.
- **2024**: Reserved guards (`##`, `#"..."`) become errors.

## Related

- [notation.md](./notation.md)
- [items.md](./items.md)
