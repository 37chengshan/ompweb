# Codegen Options

Codegen options control how `rustc` generates code. They are passed via the `-C` (or `--codegen`) flag.

## Signature / Usage

```bash
rustc -C <OPTION>[=<VALUE>] input.rs
# or
rustc --codegen <OPTION>[=<VALUE>] input.rs
```

Boolean options accept: `y` / `yes` / `on` / `true` to enable, `n` / `no` / `off` / `false` to disable.

## Options / Props

### Optimization

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `opt-level` | `0`/`1`/`2`/`3`/`s`/`z` | `0` | Optimization level; `s`=size, `z`=aggressive size |
| `lto` | `thin`/`fat`/bool | off | Link-Time Optimization; default local thin LTO |
| `codegen-units` | int > 0 | 16 (non-incremental) | Max parallel code generation units |
| `no-vectorize-loops` | bool | false | Disable LLVM loop vectorization |
| `no-vectorize-slp` | bool | false | Disable superword-level parallelism vectorization |
| `no-prepopulate-passes` | bool | false | Use empty LLVM pass list |
| `passes` | string list | — | Extra LLVM passes (space-separated) |
| `llvm-args` | string list | — | Arguments passed directly to LLVM (space-separated) |

### Debug Information

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debuginfo` | `0`/`none`/`line-directives-only`/`line-tables-only`/`1`/`limited`/`2`/`full` | `0` | Debug information level |
| `dwarf-version` | `2`/`3`/`4`/`5` | 4 | DWARF debug info version |
| `split-debuginfo` | `off`/`packed`/`unpacked` | platform-dependent | Split debuginfo emission |
| `strip` | `none`/`debuginfo`/`symbols` | `none` | Strip debuginfo or symbols at link time |
| `collapse-macro-debuginfo` | `y`/`n`/`external` | — | Collapse macro source locations in debuginfo |
| `save-temps` | bool | false | Retain temporary files after compilation |

### Code Generation Control

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `target-cpu` | string | — | Generate code for a specific CPU; `native` for host |
| `target-feature` | `+/-FEAT` list | — | Enable/disable target features (comma-separated) |
| `tune-cpu` | string | — | Schedule for a CPU without changing compatibility (unstable) |
| `code-model` | `tiny`/`small`/`kernel`/`medium`/`large` | `small` | Code model for addressing |
| `relocation-model` | `static`/`pic`/`pie`/... | target default | Position-independent code model |
| `relro-level` | `off`/`partial`/`full` | `full` | RELRO exploit mitigation level (ELF only) |
| `jump-tables` | bool | true | Allow LLVM to create jump tables |
| `no-redzone` | bool | target default | Disable the red zone |
| `soft-float` | bool | false | Use software floating-point emulation (**deprecated/unsound**) |
| `symbol-mangling-version` | `v0` | compiler default | Name mangling format |
| `metadata` | string list | — | Strings used in symbol mangling for disambiguation |

### Debug Assertions and Overflow

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug-assertions` | bool | true at `opt-level=0` | Enable `cfg(debug_assertions)` |
| `overflow-checks` | bool | true when debug_assertions | Panic on integer overflow |

### Panic

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `panic` | `unwind`/`abort`/`immediate-abort` | `unwind` | Panic strategy; all crates in a binary must agree |

### Linking

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `linker` | path | — | Linker executable to use |
| `linker-flavor` | `gcc`/`ld`/`msvc`/`wasm-ld`/`ld.lld`/... | target default | Linker flavor |
| `linker-features` | `+/-FEAT` list | — | Enable/disable linker features (stable: `lld` on x86_64-linux-gnu) |
| `linker-plugin-lto` | bool or path | false | Defer LTO to the linker |
| `link-arg` | string | — | Append one extra argument to the linker (repeatable) |
| `link-args` | string list | — | Append multiple arguments to the linker (space-separated) |
| `link-dead-code` | bool | false | Keep dead code that would otherwise be removed |
| `link-self-contained` | bool or `+/-COMP` | heuristic | Use Rust-shipped libraries instead of system |
| `default-linker-libraries` | bool | false | Include linker's default libraries |
| `prefer-dynamic` | bool | false | Prefer dynamic linking over static |
| `rpath` | bool | false | Set rpath in output (Unix-like only) |
| `dlltool` | path | — | dlltool path for `windows-gnu` import libraries |

### Profile-Guided Optimization

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `profile-generate` | path | — | Emit instrumented binary; outputs `.profraw` files to path |
| `profile-use` | path | — | Use `.profdata` file for PGO optimizations |

### Coverage

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `instrument-coverage` | bool | false | Enable LLVM-based source-level coverage instrumentation |

### Miscellaneous

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `incremental` | path | — | Enable incremental compilation; path to incremental files dir |
| `embed-bitcode` | bool | true | Embed LLVM bitcode in object files (required for LTO) |
| `extra-filename` | string | — | Suffix appended to output filenames |
| `force-frame-pointers` | bool | — | Force use of frame pointers |
| `force-unwind-tables` | bool | — | Force generation of unwind tables |
| `remark` | `all` or list | — | Print LLVM optimization remarks |
| `control-flow-guard` | bool/`nochecks` | false | Windows Control Flow Guard (Windows only) |

## Notes

- Run `rustc --print code-models`, `--print relocation-models`, `--print target-cpus`, `--print target-features` to see values available on the current target.
- `target-feature` is **unsafe**; enabling an unsupported feature causes undefined behavior at runtime.
- `lto` is incompatible with `embed-bitcode=no`. With `codegen-units=1` or `opt-level=0`, LTO is disabled.
- `incremental` is not recommended for release builds as it inhibits certain optimizations.
- `soft-float` is deprecated and unsound on `*eabihf` targets.
- `tune-cpu` is currently only effective on x86 targets.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
- [profile-guided-optimization.md](./profile-guided-optimization.md)
- [instrument-coverage.md](./instrument-coverage.md)
- [linker-plugin-lto.md](./linker-plugin-lto.md)
