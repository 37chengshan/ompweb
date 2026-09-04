# Edition Guide

| Name | Description | Path |
|------|-------------|------|
| Creating a New Project | `cargo new` defaults to the latest stable edition. Use `--edition` to target a specific edition. | [creating-new-project.md](./creating-new-project.md) |
| Rust 2015 | **Theme: Stability** — The original edition, released with Rust 1.0 (May 2015). It is the implicit default for any crate that does not specify `edition` in `Cargo.toml`. | [rust-2015.md](./rust-2015.md) |
| Rust 2018 | **Theme: Productivity** — Released with Rust 1.31.0 (December 6, 2018). RFC [#2052](https://rust-lang.github.io/rfcs/2052-epochs.html). | [rust-2018.md](./rust-2018.md) |
| Rust 2021 | **Theme: Consistency & capability** — Released with Rust 1.56.0 (October 21, 2021). RFC [#3085](https://github.com/rust-lang/rfcs/pull/3085). | [rust-2021.md](./rust-2021.md) |
| Rust 2024 | **Released with Rust 1.85.0 (February 20, 2025). RFC [#3501](https://rust-lang.github.io/rfcs/3501-edition-2024.html).** | [rust-2024.md](./rust-2024.md) |
| Transitioning an Existing Project to a New Edition | Rust provides `cargo fix --edition` to automate most of the work. Follow the steps below in order. | [transitioning-existing-project.md](./transitioning-existing-project.md) |
| What are Editions? | Editions are Rust's mechanism for introducing backwards-incompatible changes while preserving stability guarantees. Each crate opts in independently by setting `edition` in `Cargo.toml`. | [what-is-edition.md](./what-is-edition.md) |
