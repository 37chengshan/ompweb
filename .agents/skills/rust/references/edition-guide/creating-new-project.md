# Creating a New Project

`cargo new` defaults to the latest stable edition. Use `--edition` to target a specific edition.

## Signature / Usage

```bash
# Default (latest edition — currently 2024)
cargo new my-project

# Specific edition
cargo new --edition 2021 my-project
```

Generated `Cargo.toml`:

```toml
[package]
name = "my-project"
version = "0.1.0"
edition = "2024"

[dependencies]
```

## Options / Props

| Flag | Values | Description |
|------|--------|-------------|
| `--edition <YEAR>` | `2015`, `2018`, `2021`, `2024` | Edition for the new package |

## Notes

- Specifying an invalid year is a hard error: `error: invalid value '2019' for '--edition <YEAR>'`.
- The edition can be changed later by editing `Cargo.toml` directly, though `cargo fix --edition` should be run to update source code as well.

## Related

- [What are Editions?](./what-is-edition.md)
- [Transitioning an existing project](./transitioning-existing-project.md)
