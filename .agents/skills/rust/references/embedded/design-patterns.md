# Design Patterns

This chapter collects patterns recommended for embedded Rust, with a focus on HAL (Hardware Abstraction Layer) design. It supplements the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) with embedded-specific concerns.

## HAL Design Checklist

### Naming
- **C-CRATE-NAME**: Crate named per Rust conventions (`stm32f3xx-hal`, not `STM32F3xxHAL`)

### Interoperability
- **C-FREE**: Wrapper types provide a destructor/release method to reclaim the underlying resource
- **C-REEXPORT-PAC**: HAL crates re-export their underlying PAC (`pub use stm32f3 as pac;`)
- **C-HAL-TRAITS**: Peripheral types implement the relevant `embedded-hal` traits

### Predictability
- **C-CTOR**: Peripheral initialization uses constructor methods (not extension traits) for clarity

### GPIO Interfaces
- **C-ZST-PIN**: Pin types are zero-sized by default (no runtime storage)
- **C-ERASED-PIN**: Pin types provide methods to erase pin/port identity for use in arrays
- **C-PIN-STATE**: Pin direction state encoded as type parameter (`PA5<Output<PushPull>>`)

## Typestate / Builder Pattern

Use types to enforce initialization order:

```rust
// Serial port that must be configured before use
pub struct SerialConfig { baud: u32 }
pub struct Serial<PINS> { config: SerialConfig, pins: PINS }

impl SerialConfig {
    pub fn new() -> Self { Self { baud: 9600 } }
    pub fn baud(mut self, baud: u32) -> Self { self.baud = baud; self }
    pub fn build<PINS>(self, pins: PINS) -> Serial<PINS> {
        Serial { config: self, pins }
    }
}

let uart = SerialConfig::new().baud(115200).build(pins);
```

## Pin Type Erasure

Erasing pin type allows storing heterogeneous pins in a collection:

```rust
// Specific type
let pa5: PA5<Output<PushPull>> = gpioa.pa5.into_push_pull_output();

// Erased port (can mix PA5, PB3, PC7 in one Vec)
let pa5_erased: PXx<Output<PushPull>> = pa5.erase();

let leds: [PXx<Output<PushPull>>; 3] = [led1.erase(), led2.erase(), led3.erase()];
```

## HAL Interoperability: Re-exporting PAC

```rust
// In my-hal/src/lib.rs
pub use my_pac as pac;  // users can access raw PAC if HAL doesn't cover something
```

## C-FREE: Destructor Pattern

```rust
impl Serial<PINS> {
    /// Release the underlying peripheral and pins
    pub fn free(self) -> (USART1, PINS) {
        (self.usart, self.pins)
    }
}
```

Allows returning peripherals to the PAC layer for reconfiguration.

## Notes

- Prefer constructor methods over extension traits; constructors appear in rustdoc naturally grouped with the type
- Zero-sized pin types are important for performance: arrays of pins in tight loops should compile to pure register writes
- The full HAL design guide is at: https://doc.rust-lang.org/embedded-book/design-patterns/hal/

## Related

- [portability.md](./portability.md)
- [static-guarantees.md](./static-guarantees.md)
- [memory-mapped-registers.md](./memory-mapped-registers.md)
