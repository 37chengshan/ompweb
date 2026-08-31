# samples

| Name | Description | Path |
|------|-------------|------|
| Async / Await with Tokio | Write non-blocking I/O with `async`/`await` using the Tokio runtime. | [async-tokio.md](./async-tokio.md) |
| Collections | Work with the three most common standard-library collections: `Vec<T>`, `String`, and `HashMap<K, V>`. | [collections.md](./collections.md) |
| Concurrency with Threads | Spawn OS threads, share data via message-passing channels, and synchronize shared state with `Arc<Mutex<T>>`. | [concurrency-threads.md](./concurrency-threads.md) |
| Enums and Pattern Matching | Model domain variants with `enum`, extract data exhaustively with `match`, and use `Option<T>` instead of null. | [enums-and-pattern-matching.md](./enums-and-pattern-matching.md) |
| Error Handling | Use `Result<T, E>` and the `?` operator to propagate recoverable errors without nested `match`. | [error-handling.md](./error-handling.md) |
| Iterators and Closures | Process sequences with lazy iterator adapters and closures that capture their environment. | [iterators-and-closures.md](./iterators-and-closures.md) |
| Ownership and Borrowing | Demonstrate move semantics, cloning, and the borrow rules (immutable/mutable references). | [ownership-and-borrowing.md](./ownership-and-borrowing.md) |
| Structs and Methods | Group related data in a struct and attach behavior with `impl` blocks. | [structs-and-methods.md](./structs-and-methods.md) |
| Testing | Write unit tests inline with source code and integration tests in a separate `tests/` directory. | [testing.md](./testing.md) |
| Traits and Generics | Define shared behavior with traits, write generic functions with trait bounds, and annotate lifetimes. | [traits-and-generics.md](./traits-and-generics.md) |
