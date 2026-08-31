# Notation

The Rust Reference uses a specific grammar notation for describing lexical and syntactic productions.

## Grammar Notation Rules

### Token Types

| Notation | Example | Meaning |
|----------|---------|---------|
| `CAPITAL` | `KW_IF`, `INTEGER_LITERAL` | A token produced by the lexer |
| `_ItalicCamelCase_` | `_LetStatement_`, `_Item_` | A syntactical production |
| `` `string` `` | `` `x` ``, `` `while` `` | Exact character(s) |

### Repetition and Optionality

| Notation | Meaning |
|----------|---------|
| `x?` | 0 or 1 of x |
| `x*` | 0 or more of x |
| `x+` | 1 or more of x |
| `xa..b` | a to b repetitions (exclusive upper bound) |
| `xa..=b` | a to b repetitions (inclusive upper bound) |
| `xn:a..=b` | repetitions with count bound to name n |
| `xn` | x repeated n times (from previous binding) |

### Structure and Alternation

| Notation | Meaning |
|----------|---------|
| Sequence | Rules listed in order |
| `\|` | Either one or another (alternation) |
| `( )` | Groups items |
| `!` | Negative lookahead (matches if NOT present, consumes nothing) |

### Character Classes

| Notation | Meaning |
|----------|---------|
| `[ ]` | Any of the listed characters |
| `[ - ]` | Any character in the range |
| `~[ ]` | Any character EXCEPT those listed |
| `~string` | Any characters EXCEPT this sequence |

### Other

| Notation | Meaning |
|----------|---------|
| `^` | Hard cut — prevents backtracking past this point |
| `U+xxxx` | Single Unicode character |
| `<text>` | English prose description |

## Operator Precedence

Sequences have higher precedence than `|` alternation.

## The Hard Cut Operator (`^`)

Once all expressions to the left of `^` in a sequence have matched, the rest **must** match or parsing fails unconditionally — no backtracking.

```
// Without hard cut, "c\0" could backtrack and parse as identifier `c` + string "\0".
// The ^ after c" prevents this:
C_STRING_LITERAL → `c` ^ `"` ...
```

## Grammar Visualizations

Below each grammar block is a toggle for a **syntax diagram**:
- Square element = non-terminal rule
- Rounded rectangle = terminal

## Related

- [lexical-structure.md](./lexical-structure.md)
