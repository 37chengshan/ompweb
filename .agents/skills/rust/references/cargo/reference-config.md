# Configuration

Cargo reads configuration from `.cargo/config.toml` files. Settings are merged hierarchically from the current directory up to the home directory.

## File Locations (Search Order)

```
/projects/foo/bar/baz/.cargo/config.toml
/projects/foo/bar/.cargo/config.toml
/projects/foo/.cargo/config.toml
/projects/.cargo/config.toml
/.cargo/config.toml
$CARGO_HOME/config.toml   # ~/.cargo/config.toml on Unix
```

Cargo also accepts the legacy `.cargo/config` (without `.toml`), added in v1.39.

## Precedence (Highest → Lowest)

1. `--config` command-line flag
2. Environment variables (`CARGO_*`)
3. Closer config files (project-level)
4. Home directory config (`$CARGO_HOME/config.toml`)

Scalars: higher-precedence value wins. Arrays: values are joined.

## Main Configuration Tables

### `[alias]`

```toml
[alias]
b = "build"
c = "check"
rr = "run --release"
t = ["test", "--", "--nocapture"]
```

### `[build]`

```toml
[build]
jobs = 4                          # parallel jobs (default: # of CPUs)
rustc = "rustc"                   # compiler binary
rustc-wrapper = "sccache"         # wrap rustc invocations (e.g., caching)
rustc-workspace-wrapper = "…"     # wrapper for workspace members only
rustdoc = "rustdoc"
target = "aarch64-unknown-linux-gnu"  # cross-compile target
target-dir = "target"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
rustdocflags = ["…"]
incremental = true
```

### `[http]`

```toml
[http]
proxy = "host:port"
timeout = 30                      # seconds
ssl-version = "tlsv1.3"
cainfo = "cert.pem"
multiplexing = true               # HTTP/2
```

### `[net]`

```toml
[net]
retry = 3
git-fetch-with-cli = true         # use system git instead of libgit2
offline = true

[net.ssh]
known-hosts = ["..."]
```

### `[registry]` and `[registries]`

```toml
[registry]
default = "crates-io"
token = "…"                       # crates.io token (prefer credentials.toml)
global-credential-providers = ["cargo:token", "cargo:libsecret"]

[registries.my-registry]
index = "https://my-registry.example.com/index"
token = "…"

[registries.crates-io]
protocol = "sparse"               # "sparse" | "git"
```

### `[source]`

```toml
[source.crates-io]
replace-with = "my-vendor"

[source.my-vendor]
directory = "vendor"
```

### `[target]`

```toml
[target.x86_64-unknown-linux-gnu]
linker = "x86_64-linux-gnu-gcc"
runner = "wine"
rustflags = ["-C", "target-cpu=native"]

[target.'cfg(all(target_arch = "arm", target_os = "none"))']
runner = "my-arm-simulator"

# Override build script output for a linked library
[target.x86_64-unknown-linux-gnu.foo]
rustc-link-lib = ["foo"]
rustc-link-search = ["/usr/lib"]
```

### `[env]`

```toml
[env]
MY_VAR = "value"
MY_RELATIVE_PATH = { value = "relative/path", relative = true }
FORCE_OVERRIDE = { value = "always", force = true }
```

### `[term]`

```toml
[term]
quiet = false
verbose = false
color = "auto"          # "auto" | "always" | "never"
progress.when = "auto"
progress.width = 80
```

### Other Tables

```toml
[cargo-new]
vcs = "git"             # "git" | "hg" | "pijul" | "fossil" | "none"

[install]
root = "/usr/local"     # cargo install destination

[doc]
browser = "firefox"

[future-incompat-report]
frequency = "always"    # "always" | "never"

[cache]
auto-clean-frequency = "1 day"
```

## Environment Variable Overrides

Any config key maps to `CARGO_<KEY>` with dots and dashes replaced by underscores (uppercase):

```bash
CARGO_BUILD_JOBS=4
CARGO_HTTP_TIMEOUT=60
CARGO_TERM_COLOR=always
CARGO_REGISTRIES_MY_REGISTRY_TOKEN=mytoken
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=gcc
```

## Command-Line Overrides

```bash
cargo --config net.git-fetch-with-cli=true fetch
cargo --config "build.jobs=4" build
cargo --config 'build.rustflags = ["-C", "lto"]' build
cargo --config ./my-config.toml build
```

## Credentials

Sensitive tokens are stored separately in `$CARGO_HOME/credentials.toml` (not committed to VCS):

```toml
[registry]
token = "…"

[registries.my-registry]
token = "…"
```

## Notes

- Cargo does NOT read config files from individual crate directories when invoked from a workspace root.
- The `.cargo/config.toml` file closest to the project takes precedence over parent directories.
- `CARGO_ENCODED_RUSTFLAGS` uses the `0x1f` (ASCII unit separator) delimiter instead of spaces — useful when flags may contain spaces.

## Related

- [reference-environment-variables.md](./reference-environment-variables.md)
- [reference-registry-auth.md](./reference-registry-auth.md)
- [reference-source-replacement.md](./reference-source-replacement.md)
- [reference-profiles.md](./reference-profiles.md)
