# JSON Output

`rustc` can emit machine-readable JSON messages to stderr, useful for IDEs, build tools, and CI systems.

## Signature / Usage

```bash
rustc --error-format=json [--json=<OPTIONS>] input.rs
```

JSON messages are emitted **one per line to stderr**. Each message has a `$message_type` field.

## Options / Props

### `--error-format`

| Value | Description |
|-------|-------------|
| `human` | Default human-readable output |
| `json` | Enable JSON output |
| `short` | Short human-readable output |

### `--json` Modifiers

| Value | Description |
|-------|-------------|
| `diagnostic-short` | Emit diagnostics in short form |
| `diagnostic-rendered-ansi` | Include ANSI color codes in `rendered` field |
| `artifacts` | Emit artifact notifications when files are saved |
| `future-incompat` | Emit future-incompatibility reports |
| `unused-externs` | Emit unused dependency notifications (exits with error if any) |
| `unused-externs-silent` | Same as above but no error exit code |
| `timings` | Emit section timing events (requires `-Zunstable-options`) |

Multiple values can be combined with commas: `--json=artifacts,future-incompat`.

## Message Types

### Diagnostic (`$message_type: "diagnostic"`)

```json
{
    "$message_type": "diagnostic",
    "message": "unused variable: `x`",
    "code": { "code": "unused_variables", "explanation": null },
    "level": "warning",
    "spans": [ ... ],
    "children": [ ... ],
    "rendered": "warning: unused variable: `x`\n ..."
}
```

**Top-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Primary diagnostic message |
| `code` | object or null | `{ code, explanation }` — unique identifier for the diagnostic |
| `level` | string | `"error"`, `"warning"`, `"note"`, `"help"`, `"failure-note"`, `"error: internal compiler error"` |
| `spans` | array | Source code locations (see below) |
| `children` | array | Attached child diagnostics |
| `rendered` | string or null | Pre-rendered diagnostic as shown by rustc |

**Span object fields:**

| Field | Type | Description |
|-------|------|-------------|
| `file_name` | string | Source file path |
| `byte_start` / `byte_end` | int | Byte offsets (0-based, Unicode Scalar Values) |
| `line_start` / `line_end` | int | Line numbers (1-based, inclusive) |
| `column_start` / `column_end` | int | Column offsets (1-based, character units) |
| `is_primary` | bool | Whether this is the focal span |
| `text` | array | Original source lines with highlight range |
| `label` | string or null | Message at the span location |
| `suggested_replacement` | string or null | Suggested code fix |
| `suggestion_applicability` | string or null | `"MachineApplicable"`, `"MaybeIncorrect"`, `"HasPlaceholders"`, `"Unspecified"` |
| `expansion` | object or null | Macro expansion details |

### Artifact (`$message_type: "artifact"`)

Emitted when `--json=artifacts` is set.

```json
{
    "$message_type": "artifact",
    "artifact": "libfoo.rlib",
    "emit": "link"
}
```

**Artifact types:** `link`, `dep-info`, `metadata`, `asm`, `llvm-ir`, `llvm-bc`, `mir`, `obj`

### Future-Incompatible (`$message_type: "future_incompat"`)

Emitted when `--json=future-incompat` is set.

```json
{
    "$message_type": "future_incompat",
    "future_incompat_report": [ { "diagnostic": { ... } } ]
}
```

### Unused Dependency

Emitted when `--json=unused-externs` or `--json=unused-externs-silent` is set.

```json
{
    "lint_level": "deny",
    "unused_names": ["foo"]
}
```

### Timing (`$message_type: "section_timing"`)

Emitted when `--timings` with `-Zunstable-options` is set.

```json
{
    "$message_type": "section_timing",
    "event": "start",
    "name": "link",
    "time": 12345
}
```

`time` is microseconds relative to compilation start. Sections can be nested.

## Notes

- New fields may be added without notice; parsers must be forward-compatible.
- Enumerated fields (`level`, `suggestion_applicability`) may gain new values in future versions.
- The `cargo_metadata` crate on crates.io provides a Rust parser for these messages.
- `byte_start`/`byte_end` count Unicode Scalar Values, not bytes.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
