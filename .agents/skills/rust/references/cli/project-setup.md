# Project Setup

Bootstrap a new Rust CLI project with `cargo new`, producing a `Cargo.toml` and `src/main.rs` ready to run.

## Signature / Usage

```console
$ cargo new grrs
     Created binary (application) `grrs` package
$ cd grrs/
$ cargo run
   Compiling grrs v0.1.0 (...)
    Finished dev [unoptimized + debuginfo] target(s) in 0.70s
     Running `target/debug/grrs`
Hello, world!
```

## Notes

- `cargo new <name>` creates a binary project by default; use `--lib` for a library.
- `Cargo.toml` holds metadata and the dependency list; `src/main.rs` is the entry point.
- Run with `cargo run` during development; `cargo build --release` for an optimized binary.

## Related

- [parsing-arguments.md](./parsing-arguments.md)
