# Registry Authentication

Cargo authenticates to registries using credential providers — external executables or built-in providers that store and retrieve tokens.

## Recommended Configuration

Set global credential providers in `$CARGO_HOME/config.toml` (`~/.cargo/config.toml`):

```toml
[registry]
global-credential-providers = ["cargo:token", "cargo:libsecret", "cargo:macos-keychain", "cargo:wincred"]
```

Later entries have higher precedence. Cargo attempts each provider in reverse order.

## Built-in Providers

### `cargo:token`

Stores tokens in `~/.cargo/credentials.toml` as **unencrypted plain text**.

```toml
# ~/.cargo/credentials.toml
[registry]
token = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[registries.my-registry]
token = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

Also reads from environment variables (must be listed in `global-credential-providers` to enable env var support):

```bash
CARGO_REGISTRY_TOKEN=mytoken
CARGO_REGISTRIES_MY_REGISTRY_TOKEN=mytoken
```

Supports `cargo login` and `cargo logout`.

### `cargo:wincred`

Stores tokens in the Windows Credential Manager. Listed as `cargo-registry:<index-url>` under "Windows Credentials".

### `cargo:macos-keychain`

Stores tokens in the macOS Keychain. View via the Keychain Access app.

### `cargo:libsecret`

Stores tokens using [libsecret](https://wiki.gnome.org/Projects/Libsecret) (Linux). Compatible with GNOME Keyring, KDE Wallet Manager (5.97.0+), KeePassXC (2.5.0+).

### `cargo:token-from-stdout <command> [args...]`

Launches a subprocess that returns a token on stdout:

```toml
[registry]
global-credential-providers = ["cargo:token-from-stdout /usr/local/bin/get-token"]
```

The process receives:
- `CARGO` — path to the cargo binary
- `CARGO_REGISTRY_INDEX_URL` — registry index URL
- `CARGO_REGISTRY_NAME_OPT` — optional registry name

Must exit 0 on success. Does NOT support `cargo login` or `cargo logout`.

## Third-Party Credential Plugins

Install and configure third-party providers:

```bash
cargo install cargo-credential-1password
```

```toml
[registry]
global-credential-providers = ["cargo:token", "cargo-credential-1password --account my.1password.com"]
```

For paths or arguments containing spaces, use the `[credential-alias]` table:

```toml
[credential-alias]
my-provider = ["/path/with spaces/cargo-credential", "--arg", "value"]

[registry]
global-credential-providers = ["cargo:token", "my-provider"]
```

## Per-Registry Configuration

```toml
[registries.my-registry]
index = "https://my-registry.example.com/index"
credential-provider = "cargo:token"   # override for this registry only
```

## Login and Logout

```bash
cargo login                          # authenticate with crates.io
cargo login --registry my-registry  # authenticate with specific registry
cargo logout                         # remove stored crates.io credentials
cargo logout --registry my-registry  # remove specific registry credentials
```

## Notes

- `cargo:token` stores credentials in plain text. Use a system keychain provider (`cargo:wincred`, `cargo:macos-keychain`, `cargo:libsecret`) for better security.
- For CI environments, use the `CARGO_REGISTRY_TOKEN` environment variable.
- The credential provider protocol is documented in the Cargo Book under [Credential Provider Protocol](https://doc.rust-lang.org/cargo/reference/credential-provider-protocol.html).

## Related

- [reference-registries.md](./reference-registries.md)
- [reference-config.md](./reference-config.md)
- [reference-publishing.md](./reference-publishing.md)
