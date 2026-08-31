# Profile-Guided Optimization

Profile-Guided Optimization (PGO) uses runtime profiling data to improve compiler optimization decisions such as inlining, machine-code layout, and register allocation.

## Signature / Usage

```bash
# Step 1: Compile with instrumentation
rustc -C profile-generate=/tmp/pgo-data main.rs

# Step 2: Run the instrumented binary (generates .profraw files)
./main

# Step 3: Merge profiling data
llvm-profdata merge -o ./merged.profdata /tmp/pgo-data

# Step 4: Recompile using profiling data
rustc -C profile-use=./merged.profdata -O ./main.rs
```

## Options / Props

| Option | Description |
|--------|-------------|
| `-C profile-generate=<PATH>` | Emit instrumented binary; `.profraw` files are written to PATH |
| `-C profile-use=<PATH>` | Specify `.profdata` file for PGO; PATH is mandatory |
| `-C llvm-args=-pgo-warn-missing-function` | Warn when profiling data is missing for a function |

## Complete Cargo Workflow

```bash
# Install LLVM tools
rustup component add llvm-tools-preview

# Step 1: Clean previous profiling data
rm -rf /tmp/pgo-data

# Step 2: Build instrumented binaries
RUSTFLAGS="-C profile-generate=/tmp/pgo-data" \
    cargo build --release --target=x86_64-unknown-linux-gnu

# Step 3: Run with representative workloads
./target/x86_64-unknown-linux-gnu/release/myprogram mydata1.csv
./target/x86_64-unknown-linux-gnu/release/myprogram mydata2.csv

# Step 4: Merge profiling data
llvm-profdata merge -o /tmp/pgo-data/merged.profdata /tmp/pgo-data

# Step 5: Build optimized binary
RUSTFLAGS="-C profile-use=/tmp/pgo-data/merged.profdata" \
    cargo build --release --target=x86_64-unknown-linux-gnu
```

## Notes

- Use **absolute paths** for `-C profile-generate` and `-C profile-use` when using Cargo.
- Always pass `--target` with Cargo to prevent build scripts from emitting `.profraw` files.
- Use `--release` since PGO is most beneficial when combined with other optimizations.
- Multiple runs of the instrumented binary **accumulate** profiling data into the same `.profraw` files.
- `llvm-profdata` is installed via `rustup component add llvm-tools-preview`.
- The `cargo-pgo` crate automates the entire workflow: `cargo pgo build` + `cargo pgo optimize`.

## Related

- [codegen-options.md](./codegen-options.md)
- [instrument-coverage.md](./instrument-coverage.md)
