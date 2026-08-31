# Testing CLIs

Test CLI applications at two levels: unit tests for pure logic functions, and integration tests that run the compiled binary as a subprocess.

## Signature / Usage

```toml
# Cargo.toml – dev dependencies only
[dev-dependencies]
assert_cmd = "2"
predicates = "3"
assert_fs = "1"
```

```rust
// Unit test – extract logic into a function with a generic writer
fn find_matches(content: &str, pattern: &str, mut writer: impl std::io::Write) {
    for line in content.lines() {
        if line.contains(pattern) {
            writeln!(writer, "{}", line).unwrap();
        }
    }
}

#[test]
fn find_a_match() {
    let mut result = Vec::new();
    find_matches("lorem ipsum\ndolor sit amet", "lorem", &mut result);
    assert_eq!(result, b"lorem ipsum\n");
}
```

```rust
// Integration test – tests/cli.rs
use assert_cmd::Command;
use assert_fs::prelude::*;
use predicates::prelude::*;

#[test]
fn file_doesnt_exist() {
    let mut cmd = Command::cargo_bin("grrs").unwrap();
    cmd.arg("foobar").arg("test/file/doesnt/exist");
    cmd.assert().failure().stderr(predicate::str::contains("No such file"));
}

#[test]
fn find_content_in_file() {
    let file = assert_fs::NamedTempFile::new("sample.txt").unwrap();
    file.write_str("A test\nActual content\nMore content\nAnother test").unwrap();

    let mut cmd = Command::cargo_bin("grrs").unwrap();
    cmd.arg("test").arg(file.path());
    cmd.assert().success().stdout(predicate::str::contains("A test"));
}
```

## Notes

- Rust's built-in `#[test]` attribute and `cargo test` require no extra crates for unit tests.
- **Unit tests**: extract core logic into free functions that accept `impl std::io::Write` instead of printing to stdout directly; pass `Vec<u8>` as the writer in tests.
- **Integration tests**: place in `tests/cli.rs`; `assert_cmd` compiles the binary via `Command::cargo_bin`.
- `assert_fs::NamedTempFile` creates temporary files that are automatically deleted when the variable goes out of scope.
- `predicates` provides composable assertion helpers (`contains`, `starts_with`, `is_empty`, etc.) with descriptive failure messages.
- Split `src/main.rs` into `src/lib.rs` (logic, `pub fn`) + `src/main.rs` (thin `fn main`) to make library functions reusable in tests without subprocess overhead.
- `cargo` looks for integration tests in `tests/`, benchmarks in `benches/`, and examples in `examples/`.
- Consider [`proptest`](https://docs.rs/proptest) for property-based testing and a [fuzzer](https://rust-fuzz.github.io/book/) for programs that parse arbitrary input.

## Related

- [human-communication.md](./human-communication.md)
- [packaging-distribution.md](./packaging-distribution.md)
