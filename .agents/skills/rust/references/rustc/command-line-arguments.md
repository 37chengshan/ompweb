# Command-line Arguments

`rustc` accepts flags and arguments to control compilation, linking, output, and diagnostics. Most users invoke it indirectly through Cargo, but direct invocation is useful for custom build systems.

## Signature / Usage

```bash
rustc [OPTIONS] INPUT
```

## Options / Props

### Help and Information

| Flag | Description |
|------|-------------|
| `-h` / `--help` | Print help information |
| `-V` / `--version` | Print rustc's version |
| `--explain <CODE>` | Provide detailed explanation of an error code (e.g. `E0425`) |
| `--print <INFO>` | Print compiler information (see `--print` options below) |

### Configuration and Compilation

| Flag | Description |
|------|-------------|
| `--cfg <SPEC>` | Configure `#[cfg]` settings; bare identifier or `KEY="value"` |
| `--check-cfg <SPEC>` | Enable compile-time checking of conditional compilation |
| `--crate-type <TYPE>` | Crate type(s) to emit: `lib`, `rlib`, `staticlib`, `dylib`, `cdylib`, `bin`, `proc-macro` |
| `--crate-name <NAME>` | Specify the crate name |
| `--edition <YEAR>` | Rust edition: `2015`, `2018`, `2021`, `2024` |
| `--target <TRIPLE>` | Target triple to build for |

### Output Control

| Flag | Description |
|------|-------------|
| `--emit <TYPES>` | Output types: `asm`, `dep-info`, `link`, `llvm-bc`, `llvm-ir`, `metadata`, `mir`, `obj` |
| `-o <FILE>` | Output filename; `-` for stdout |
| `--out-dir <DIR>` | Directory for output files |

### Library and Linking

| Flag | Description |
|------|-------------|
| `-L [KIND=]PATH` | Add directory to library search path; KIND: `dependency`, `crate`, `native`, `framework`, `all` |
| `-l [KIND[:MODIFIERS]=]NAME[:RENAME]` | Link to a native library |
| `--extern NAME=PATH` | Specify location of an external crate |
| `--sysroot <PATH>` | Override the system root |

### Linking Modifiers (for `-l static`)

| Modifier | Default | Description |
|----------|---------|-------------|
| `whole-archive` | `-` | Link static library as whole archive |
| `bundle` | `+` | Bundle static library into rlib/staticlib |
| `verbatim` | `-` | Don't add target-specific prefixes/suffixes |

### Optimization and Debug

| Flag | Description |
|------|-------------|
| `-O` | Optimize (equivalent to `-C opt-level=3`) |
| `-g` | Include debug info (equivalent to `-C debuginfo=2`) |
| `-C <OPT>[=VAL]` | Codegen options (see `codegen-options.md`) |

### Testing

| Flag | Description |
|------|-------------|
| `--test` | Build a test harness binary |

### Lint Control

| Flag | Description |
|------|-------------|
| `-W <LINT>` | Set lint to warn |
| `--force-warn <LINT>` | Force lint to warn (cannot be overridden by attributes) |
| `-A <LINT>` | Allow a lint |
| `-D <LINT>` | Deny a lint (error) |
| `-F <LINT>` | Forbid a lint (cannot be overridden) |
| `--cap-lints <LEVEL>` | Set maximum lint level: `allow`, `warn`, `deny`, `forbid` |

### Output Formatting

| Flag | Description |
|------|-------------|
| `--error-format <FMT>` | Error format: `human` (default), `json`, `short` |
| `--json <OPTIONS>` | JSON output options: `diagnostic-short`, `diagnostic-rendered-ansi`, `artifacts`, `future-incompat`, `timings` |
| `--color <WHEN>` | Colorize output: `auto` (default), `always`, `never` |
| `--diagnostic-width <N>` | Terminal width for diagnostics |
| `-v` / `--verbose` | Use verbose output |

### Path Remapping

| Flag | Description |
|------|-------------|
| `--remap-path-prefix FROM=TO` | Remap source paths in output (repeatable) |
| `--remap-path-scope <SCOPE>` | Define scope of path remapping |

### Advanced / Unstable

| Flag | Description |
|------|-------------|
| `-Z <OPTION>` | Unstable options (nightly only); see `rustc -Z help` |
| `@PATH` | Load command-line flags from a file (UTF-8, one flag per line) |

## Notes

- Rightmost lint flag wins when the same lint is specified multiple times: `rustc -D unused -A unused` → allow.
- `--force-warn` overrides both CLI lint flags and source attributes; only `--cap-lints` can suppress it.
- `--cap-lints allow` does **not** suppress `--force-warn` lints.
- `--emit` accepts `KEY=PATH` pairs to redirect individual outputs: `--emit=llvm-ir=-,mir=./out.mir`.
- Response files (`@path`) use UTF-8 encoding; flags may be separated by Unix or Windows line endings.

## Related

- [codegen-options.md](./codegen-options.md)
- [lints.md](./lints.md)
- [json.md](./json.md)
- [check-cfg.md](./check-cfg.md)
- [targets.md](./targets.md)
