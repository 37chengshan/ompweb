# Influences

Rust draws from a wide range of languages and research traditions. As the Reference states: "Rust is not a particularly original language, with design elements coming from a wide range of sources."

## Language Influences

| Language(s) | Features Borrowed |
|-------------|-------------------|
| **SML, OCaml** | Algebraic data types, pattern matching, type inference, semicolon statement separation |
| **C++** | References, RAII (Resource Acquisition Is Initialization), smart pointers, move semantics, monomorphization of generics, memory model |
| **ML Kit, Cyclone** | Region-based memory management (foundational influence on lifetimes) |
| **Haskell (GHC)** | Typeclasses (→ traits), type families (→ associated types) |
| **Newsqueak, Alef, Limbo** | Channels and message-passing concurrency |
| **Erlang** | Message passing, thread failure and linked thread failure, lightweight concurrency model |
| **Swift** | Optional bindings (`if let`) |
| **Scheme** | Hygienic macros (→ `macro_rules!`) |
| **C#** | Attributes |
| **Ruby** | Closure syntax, block syntax |
| **NIL, Hermes** | Typestate (compile-time state tracking) |
| **Unicode Annex #31** | Identifier and pattern syntax rules |

## Key Design Synthesis

Rust's originality lies not in any single feature but in its **synthesis**:

- From ML/Haskell: expressive static type system with inference and algebraic types.
- From C++: zero-cost abstractions, value semantics, RAII.
- From Cyclone/ML Kit: memory safety without garbage collection via lifetimes and regions.
- From Erlang/Go: safe concurrency primitives.
- From Scheme: hygienic macro system.

The combination of ownership + borrowing + lifetimes is Rust's most distinctive contribution — a new approach to memory safety that does not require a garbage collector.

## Related

- [type-system.md](./type-system.md)
- [memory-model.md](./memory-model.md)
- [macros.md](./macros.md)
