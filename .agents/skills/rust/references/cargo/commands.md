# Cargo Commands

Reference for all Cargo CLI commands. Run `cargo help <command>` or `cargo <command> --help` for detailed options.

## General Commands

| Command | Description |
|---------|-------------|
| `cargo` | The Cargo package manager |
| `cargo help` | Display help information |
| `cargo version` | Show Cargo version (`cargo --version`) |

## Build Commands

| Command | Description |
|---------|-------------|
| `cargo build` | Compile the current package |
| `cargo check` | Check for errors without producing artifacts (faster than build) |
| `cargo run` | Compile and run the default binary |
| `cargo test` | Run tests |
| `cargo bench` | Run benchmarks |
| `cargo doc` | Generate documentation |
| `cargo clean` | Remove build artifacts |
| `cargo fetch` | Fetch dependencies without building |
| `cargo fix` | Automatically fix compiler warnings |
| `cargo clippy` | Run Clippy lints |
| `cargo fmt` | Format code with rustfmt |
| `cargo rustc` | Compile with extra rustc flags |
| `cargo rustdoc` | Generate docs with extra rustdoc flags |
| `cargo miri` | Run code under the Miri interpreter |

### Key Build Flags

```bash
cargo build --release              # optimized build
cargo build --target <triple>      # cross-compile
cargo build -p <package>           # specific package in workspace
cargo build --workspace            # all workspace members
cargo build --features "f1 f2"    # enable features
cargo build --all-features         # enable all features
cargo build --no-default-features  # disable default features
cargo build --profile <name>       # use custom profile
cargo build --message-format=json  # machine-readable output
cargo build --locked               # require Cargo.lock to be up to date
cargo build --offline              # no network access
cargo build -v                     # verbose
cargo build -vv                    # very verbose (shows build script output)
```

### `cargo run`

```bash
cargo run                          # run default binary
cargo run --bin my-binary          # run specific binary
cargo run --example demo           # run an example
cargo run -- arg1 arg2             # pass arguments to the binary
```

### `cargo test`

```bash
cargo test                         # run all tests
cargo test foo                     # run tests matching "foo"
cargo test --lib                   # only library tests
cargo test --test integration      # only integration tests in tests/integration.rs
cargo test --doc                   # only documentation tests
cargo test -- --nocapture          # show println! output
cargo test -- --test-threads=1     # run tests serially
```

### `cargo bench`

```bash
cargo bench                        # run all benchmarks
cargo bench my_bench               # run benchmarks matching "my_bench"
```

### `cargo doc`

```bash
cargo doc                          # generate docs
cargo doc --open                   # generate and open in browser
cargo doc --no-deps                # only this crate (not dependencies)
```

## Manifest Commands

| Command | Description |
|---------|-------------|
| `cargo add` | Add a dependency to `Cargo.toml` |
| `cargo remove` | Remove a dependency from `Cargo.toml` |
| `cargo update` | Update dependencies in `Cargo.lock` |
| `cargo tree` | Display the dependency tree |
| `cargo metadata` | Output machine-readable project metadata (JSON) |
| `cargo generate-lockfile` | Generate or update the lock file |
| `cargo locate-project` | Print the path to `Cargo.toml` |
| `cargo pkgid` | Print a package identifier |
| `cargo vendor` | Vendor all dependencies locally |

### `cargo add`

```bash
cargo add serde                        # add latest version
cargo add serde --features derive      # with feature
cargo add serde@1.0.100               # specific version
cargo add --dev tempfile               # dev dependency
cargo add --build cc                   # build dependency
cargo add --path ../my-crate           # local path dependency
cargo add --git https://...            # git dependency
```

### `cargo tree`

```bash
cargo tree                             # full dependency tree
cargo tree -e features                 # show feature edges
cargo tree --duplicates                # show duplicate crate versions
cargo tree -i <crate>                  # invert: what depends on <crate>
cargo tree -p <package>                # tree for specific package
cargo tree --workspace                 # all workspace members
```

### `cargo update`

```bash
cargo update                           # update all to latest compatible
cargo update -p regex                  # update only "regex"
cargo update --precise regex 1.9.0    # pin to exact version
cargo update --recursive               # update package and all dependents
```

### `cargo metadata`

```bash
cargo metadata --format-version 1     # always specify format-version
```

Outputs JSON with package list, dependency graph, workspace info.

### `cargo vendor`

```bash
cargo vendor                           # vendor all dependencies into vendor/
cargo vendor --sync Cargo.toml         # resync vendored deps
```

## Package Commands

| Command | Description |
|---------|-------------|
| `cargo new` | Create a new Cargo package |
| `cargo init` | Initialize a Cargo package in an existing directory |
| `cargo install` | Install a Rust binary |
| `cargo uninstall` | Uninstall a Rust binary |
| `cargo search` | Search for packages on crates.io |

### `cargo new` / `cargo init`

```bash
cargo new hello_world                  # binary crate
cargo new --lib my-lib                 # library crate
cargo new --vcs none my-project        # no git initialization
cargo init                             # initialize in current directory
```

### `cargo install`

```bash
cargo install ripgrep                  # install from crates.io
cargo install --path .                 # install from local package
cargo install --git https://...        # install from git
cargo install --locked ripgrep         # use Cargo.lock if present
cargo install --root ~/.local          # install to custom directory
cargo install --version 13.0.0 ripgrep
```

### `cargo search`

```bash
cargo search "json parser"             # search crates.io
cargo search serde --limit 20
```

## Publishing Commands

| Command | Description |
|---------|-------------|
| `cargo login` | Authenticate with a registry |
| `cargo logout` | Remove stored authentication credentials |
| `cargo package` | Create a distributable `.crate` file |
| `cargo publish` | Upload a package to a registry |
| `cargo yank` | Mark a version as not recommended |
| `cargo owner` | Manage crate ownership |

### `cargo publish`

```bash
cargo publish                          # publish to crates.io
cargo publish --dry-run                # verify without uploading
cargo publish --registry my-registry  # publish to alternate registry
cargo publish --allow-dirty            # allow uncommitted changes
```

### `cargo package`

```bash
cargo package                          # create .crate file in target/package/
cargo package --list                   # list files that would be included
```

### `cargo yank`

```bash
cargo yank --version 1.0.1            # yank version
cargo yank --version 1.0.1 --undo     # restore yanked version
```

## Report Commands

| Command | Description |
|---------|-------------|
| `cargo report` | Generate reports (e.g., future incompatibility) |

```bash
cargo report future-incompatibilities   # show future-incompat warnings
```

## Notes

- Most commands accept `-p <package>` / `--package <package>` to target a specific package in a workspace.
- `--workspace` applies the command to all workspace members.
- Use `cargo help <command>` for full option reference.
- External subcommands (`cargo-*` executables in `$PATH`) integrate as `cargo <name>`.

## Related

- [getting-started.md](./getting-started.md)
- [cargo-guide.md](./cargo-guide.md)
- [reference-external-tools.md](./reference-external-tools.md)
- [reference-publishing.md](./reference-publishing.md)
