# How to Read Rustdoc Output

Rustdoc's HTML output is divided into three main areas: the left navigation bar, the search interface at the top, and the item documentation in the main content area.

## Page Structure

| Area | Description |
|------|-------------|
| Left nav bar | Contextual links for the current entry |
| Search bar | Full-path search with JavaScript |
| Item documentation | Main content: type/name, signature, fields, impls |

## Item Documentation Section

At the top of each item page:
- **Item type and name** — e.g., `Struct std::time::Duration`
- **Copy button** — copies the item's full path to clipboard
- **`[+]` / `[-]` button** — expands or collapses top-level docs
- **`[src]` link** — jumps to source code (if enabled)
- **Stability badge** — shows the version when the item was stabilized

Below the header: documentation text, definition/signature, fields or variants, and trait implementations.

### Aliased Type Section

For type aliases, an "Aliased Type" section shows the fully expanded alias with all type parameters substituted.

## Navigation Features

### Anchors and Deep Linking

Subheadings, variants, and fields are clickable anchors. The `§` symbol appears on hover, enabling links to specific sections.

### Search Syntax

| Query | Resolves to |
|-------|------------|
| `Vec::new` | method `new` on `Vec` |
| `Vec new` | same (spaces treated as `::`) |
| `Option::Some` | variant `Some` of `Option` |
| `module::child::Struct::field` | nested path |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `S` or `/` | Focus search bar |
| `?` | Show help screen |
| `Esc` | Hide help |
| `←` / `→` | Navigate between chapters |
| `↑` / `↓` | Move among search results |
| `Enter` | Open highlighted result |
| `+` / `-` | Expand / collapse all sections |

## Theme Options

Built-in themes: Auto, Light, Rust, Coal, Navy, Ayu. The theme picker is in the top-right corner.

## Related

- [What is rustdoc?](./what-is-rustdoc.md)
- [Advanced features](./advanced-features.md)
