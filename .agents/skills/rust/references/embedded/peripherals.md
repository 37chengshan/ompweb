# Peripherals

Peripherals are hardware blocks on a microcontroller that handle external interactions (sensors, motors, communication interfaces). In embedded Rust, safe peripheral access requires preventing aliasing and encoding ownership into the type system.

## What are Peripherals?

- Silicon blocks that offload processing from the CPU (SPI, I2C, timers, GPIO, etc.)
- Exposed as **memory-mapped interfaces**: reading/writing specific addresses controls behavior
- On 32-bit MCUs the address space is divided into Flash, RAM, and peripheral regions

```
0x0000_0000 – 0x0007_FFFF : Flash ROM (512 KiB example)
0x2000_0000 – 0x2000_FFFF : RAM      (64 KiB example)
0x4000_0000 – ...          : Peripheral registers
```

## The Aliasing Problem

A naive Rust wrapper allows multiple instances pointing to the same hardware:

```rust
pub struct SystemTimer { p: &'static mut RegisterBlock }

impl SystemTimer {
    pub fn new() -> SystemTimer {
        SystemTimer { p: unsafe { &mut *(0xE000_E010 as *mut RegisterBlock) } }
    }
}

// BUG: both st1 and st2 alias the same hardware!
let st1 = SystemTimer::new();
let st2 = SystemTimer::new();
```

`&mut self` only prevents aliasing of the *struct instance*, not the underlying hardware register.

## Singleton Pattern

The solution is to give each peripheral a single owner using `Option<T>`:

```rust
struct Peripherals {
    serial: Option<SerialPort>,
}

impl Peripherals {
    fn take_serial(&mut self) -> SerialPort {
        self.serial.take().unwrap()  // panics on second call
    }
}

static mut PERIPHERALS: Peripherals = Peripherals { serial: Some(SerialPort) };

fn main() {
    let serial = unsafe { PERIPHERALS.take_serial() };
    // Second take_serial() would panic at runtime
}
```

## cortex-m Singleton Macro

```rust
use cortex_m::singleton;

let x: &'static mut bool = singleton!(: bool = false).unwrap();
```

## PAC / HAL Approach (preferred)

PAC crates implement the singleton pattern internally:

```rust
use stm32f3xx_hal::pac::Peripherals;

let dp = Peripherals::take().unwrap();  // Can only be called once
let gpioa = dp.GPIOA;
```

## RTIC Framework

RTIC (Real Time Interrupt-driven Concurrency) eliminates manual singleton management:

```rust
#[rtic::app(device = lm3s6965, peripherals = true)]
const APP: () = {
    #[init]
    fn init(cx: init::Context) {
        let _core: cortex_m::Peripherals = cx.core;
        let _device: lm3s6965::Peripherals = cx.device;
    }
};
```

## Notes

- `Peripherals::take()` panics if called twice; this is intentional to enforce single ownership
- Once a peripheral is owned, borrow checker enforces `&` / `&mut` rules on hardware access
- `&self` methods → read-only hardware access; `&mut self` methods → read-write hardware access

## Related

- [memory-mapped-registers.md](./memory-mapped-registers.md)
- [static-guarantees.md](./static-guarantees.md)
- [concurrency.md](./concurrency.md)
