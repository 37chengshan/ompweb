# Inline Assembly

Rust provides inline assembly via three macros. Supported architectures: x86/x86-64, ARM, AArch64, RISC-V, LoongArch, s390x, PowerPC/PowerPC64.

| Macro | Scope | Use Case |
|-------|-------|----------|
| `asm!` | Inside a function | Inline optimization, low-level ops |
| `naked_asm!` | Inside a naked function | Full function body in assembly |
| `global_asm!` | Global scope | Hand-written complete functions |

## Basic Syntax

```rust
use std::arch::asm;

unsafe {
    asm!(
        "template string {operand}",
        operand,
        options(...)
    );
}
```

Template strings are format-string-like with `{}` placeholders. Positional (`{0}`), named (`{name}`), and index placeholders are supported. All named/positional operands must appear at least once.

## Operand Types

### Input: `in(<reg>) <expr>`

Register holds value of `<expr>` at entry.

```rust
unsafe { asm!("/* {0} */", in(reg) 42_i64); }
```

### Output: `out(<reg>) <expr>` / `lateout`

Register value is written to a place expression after the assembly runs. `_` discards the value. `lateout` allows the allocator to reuse input registers.

```rust
let x: i64;
unsafe { asm!("mov {}, 5", out(reg) x); }
assert_eq!(x, 5);
```

### Input-Output: `inout(<reg>) <expr>` / `inlateout`

Register starts with the input value and is written back.

```rust
let mut x: i64 = 4;
unsafe { asm!("inc {}", inout(reg) x); }
assert_eq!(x, 5);

// Separate in/out expressions:
let y: i64;
unsafe { asm!("inc {}", inout(reg) 4i64 => y); }
assert_eq!(y, 5);
```

### Symbolic: `sym <path>`

Inserts the mangled symbol name of a function or static.

```rust
extern "C" fn foo() {}
unsafe { asm!("call {}", sym foo, clobber_abi("C")); }
```

### Constant: `const <expr>`

A compile-time integer constant inserted as a literal string into the template.

```rust
const N: usize = 8;
unsafe { asm!("add sp, sp, {}", const N); }
```

### Label: `label { block }`

The address of the block is substituted. Assembly can jump to it.

```rust
unsafe {
    asm!("jmp {}", label {
        println!("jumped!");
    });
}
```

## Register Constraints

Use register classes for portability:

| Class | Architecture | Registers |
|-------|-------------|-----------|
| `reg` | all | General purpose (architecture-defined) |
| `reg_byte` | x86 | `al`, `bl`, `cl`, `dl` |
| `xmm_reg` | x86 | `xmm0`–`xmm15` |
| `ymm_reg` | x86 | `ymm0`–`ymm15` |
| `freg` | AArch64/RISC-V | Floating-point registers |
| `vreg` | AArch64 | SIMD/vector registers |

Explicit register names can be specified as string literals: `"rax"`, `"eax"`, `"r0"`, etc.

## Template Modifiers

Appended after `:` in a placeholder to select register sub-type:

```rust
// x86-64
"{:l}" // low byte (al)
"{:x}" // 16-bit (ax)
"{:e}" // 32-bit (eax)
"{:r}" // 64-bit (rax)

// AArch64
"{:w}" // 32-bit (w0)
"{:x}" // 64-bit (x0)
```

## ABI Clobbers

`clobber_abi("ABI")` automatically marks all caller-saved registers of the ABI as clobbered:

```rust
unsafe {
    asm!("call {}", sym some_c_fn, out("rax") _, clobber_abi("C"));
}
```

When using `clobber_abi`, all output operands must use explicit register names.

## Options

```rust
asm!("...", options(pure, nomem, nostack))
```

| Option | Meaning |
|--------|---------|
| `pure` | No side effects; outputs depend only on inputs. Requires `nomem` or `readonly`. |
| `nomem` | Does not read or write any memory outside the assembly |
| `readonly` | May read but does not write memory outside the assembly |
| `preserves_flags` | Does not modify the flags/condition register |
| `noreturn` | Never falls through (must jump or loop forever) |
| `nostack` | Does not push to the stack or use the red zone |
| `att_syntax` | Use AT&T syntax (x86 only) |
| `raw` | Template is raw assembly; no `{}` substitution |

`nomem` and `readonly` are mutually exclusive. `pure` requires at least one output.

## Rules for Inline Assembly

1. Non-output registers have **undefined values** on entry.
2. Non-output registers must have the **same value** on exit as on entry.
3. **No unwinding** out of assembly (UB if an exception tries to propagate out).
4. Stack must be properly aligned for function calls (unless `nostack`).
5. Stack pointer must be restored to its original value before returning.
6. **x86 direction flag** must be clear on exit (restored if modified).
7. **x87 stack** must be restored to its original state (x86 only).

The compiler treats assembly as a **black box** and may duplicate, deduplicate, or reorder it relative to surrounding code.

## Practical Example (x86-64)

```rust
use std::arch::asm;

let mut x: u64 = 4;
unsafe {
    asm!(
        "mov {tmp}, {x}",
        "shl {tmp}, 1",     // tmp = x * 2
        "shl {x}, 2",       // x = x * 4
        "add {x}, {tmp}",   // x = x * 6
        x   = inout(reg) x,
        tmp = out(reg) _,
    );
}
assert_eq!(x, 24);
```

## `global_asm!`

Emits assembly in global scope. Supports only `sym`, `const`, and the `att_syntax`/`raw` options:

```rust
global_asm!(
    ".global my_asm_func",
    "my_asm_func:",
    "ret",
);
```

## Notes

- `naked_asm!` can only use `sym`, `const`, `label` operands, and `att_syntax`/`raw` options.
- Operand expressions are evaluated left to right; outputs are written left to right.

## Related

- [unsafety.md](./unsafety.md)
- [abi.md](./abi.md)
- [behavior-considered-undefined.md](./behavior-considered-undefined.md)
