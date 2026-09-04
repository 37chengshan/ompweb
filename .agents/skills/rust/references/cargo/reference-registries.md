# Registries

A registry is a source from which Cargo installs crates and fetches dependencies. The default registry is [crates.io](https://crates.io/).

## Using an Alternate Registry

Configure in `.cargo/config.toml`:

```toml
[registries]
my-registry = { index = "https://my-intranet:8080/git/index" }
# or sparse protocol:
my-registry = { index = "sparse+https://my-registry.example.com/index" }
```

Or via environment variable:

```bash
CARGO_REGISTRIES_MY_REGISTRY_INDEX=https://my-intranet:8080/git/index
```

Specify in `Cargo.toml` dependencies:

```toml
[dependencies]
private-crate = { version = "1.0", registry = "my-registry" }
```

Note: crates.io does not accept packages that depend on crates from other registries.

## Protocols

| Protocol | Index URL Format | How It Works |
|----------|-----------------|-------------|
| **Git** | `https://...` or `ssh://...` | Clones the entire index repository |
| **Sparse** | `sparse+https://...` | Downloads only needed metadata via HTTP |

Sparse is faster and uses less bandwidth. The crates.io sparse index URL is `sparse+https://index.crates.io/`.

Configure crates.io protocol:

```toml
[registries.crates-io]
protocol = "sparse"   # "sparse" | "git"
```

## Publishing to an Alternate Registry

```bash
cargo login --registry my-registry       # authenticate (once)
cargo publish --registry my-registry     # publish
```

Or set as default:

```toml
[registry]
default = "my-registry"
```

Then use without `--registry` flag.

## Restricting Which Registries Can Publish

```toml
[package]
publish = ["my-registry"]   # only allow publishing to this registry
# publish = false           # prevent publishing anywhere
```

## Authentication

Tokens stored in `$CARGO_HOME/credentials.toml`:

```toml
[registries.my-registry]
token = "854DvwSlUwEHtIo3kWy6x7UCPKHfzCmy"
```

Or via environment variable:

```bash
CARGO_REGISTRIES_MY_REGISTRY_TOKEN=mytoken
```

## Notes

- crates.io is the default and does not require registry configuration.
- When using source replacement with registries, commands contacting the registry directly require `--registry` to ensure correct authentication.
- For private registries, configure credential providers in addition to the index URL.

## Related

- [reference-registry-auth.md](./reference-registry-auth.md)
- [reference-publishing.md](./reference-publishing.md)
- [reference-source-replacement.md](./reference-source-replacement.md)
- [reference-config.md](./reference-config.md)
