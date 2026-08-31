# Passes

Rustdoc passes are transformations applied to documentation before producing final output. The `--passes` and `--no-defaults` flags used to control them are now **deprecated and unstable**.

## Status

Passes are deprecated. The available passes are not considered stable and may change in any release. Customizing passes is no longer a supported workflow.

## Migration

The most common reason to customize passes was to include private items by omitting the `strip-private` pass. Use the stable flag instead:

```bash
# Old (deprecated)
rustdoc src/lib.rs --no-defaults --passes collapse-docs --passes unindent-comments

# Modern replacement
rustdoc src/lib.rs --document-private-items
```

## Notes

- `--passes` and `--no-defaults` flags require `-Z unstable-options` on nightly and are not guaranteed to remain available.
- All stable functionality previously provided by passes is now accessible through dedicated command-line flags.

## Related

- [Command-line arguments](./command-line.md)
- [Deprecated features](https://doc.rust-lang.org/rustdoc/deprecated-features.html)
