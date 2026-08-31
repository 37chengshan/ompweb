# Tests

`rustc` supports building test harness binaries via the `--test` flag. Cargo wraps this automatically with `cargo test`.

## Signature / Usage

```bash
# Compile a test binary directly
rustc --test my_crate.rs

# Run the resulting test binary
./my_crate
```

With Cargo:

```bash
cargo test
```

## What `--test` Does

- Builds the crate as a `bin` (executable) crate type.
- Links with `libtest`, the standard test harness.
- Synthesizes a `main` function that parses CLI arguments and runs tests (replaces any existing `main`).
- Enables the `test` cfg option (`#[cfg(test)]` blocks are compiled).
- Enables compilation of `#[test]` and `#[bench]` attributed functions.

## Writing Tests

```rust
#[test]
fn it_works() {
    assert_eq!(2 + 2, 4);
}

#[test]
fn returns_result() -> Result<(), String> {
    if 2 + 2 == 4 { Ok(()) } else { Err("math is broken".into()) }
}
```

A test passes if the function returns without panicking (or returns `Ok`). It fails if it panics or returns `Err`.

## Test Attributes

| Attribute | Description |
|-----------|-------------|
| `#[test]` | Marks a free function as a test case |
| `#[should_panic]` | Test passes only if the function panics |
| `#[ignore]` | Compiled but excluded from default test runs; run with `--include-ignored` |
| `#[bench]` | Benchmark function (nightly only, unstable) |

## Test Output Format

```
running 4 tests
test it_works ... ok
test check_valid_args ... ok
test invalid_characters ... ok
test walks_the_dog ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## Runtime Options (passed to test binary)

| Option | Description |
|--------|-------------|
| `--test-threads N` | Number of threads for parallel test execution |
| `--nocapture` | Show stdout/stderr from passing tests |
| `--include-ignored` | Run `#[ignore]` tests as well |
| `RUST_TEST_THREADS=N` | Environment variable alternative to `--test-threads` |

## Notes

- All tests run in the same process, so the panic strategy must be `unwind` (not `abort`).
- Tests run in parallel by default using available hardware concurrency.
- The `test` cfg is set by `--test`; use `#[cfg(test)]` to include test-only code.
- `#[bench]` functions require nightly Rust.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
