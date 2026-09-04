# Portability

Embedded hardware varies greatly across vendors. `embedded-hal` provides a trait-based Hardware Abstraction Layer that lets drivers work across different microcontrollers without modification.

## The Problem: M × N Complexity

Without abstraction: every driver must be reimplemented for every hardware platform → M platforms × N drivers implementations needed.

With `embedded-hal` traits: M platform implementations + N driver implementations. Drivers just depend on traits; platforms implement them.

## embedded-hal Traits

Standard interfaces defined in the `embedded-hal` crate:

| Trait | Interface |
|-------|-----------|
| `digital::v2::InputPin` | GPIO input |
| `digital::v2::OutputPin` | GPIO output |
| `serial::Read` / `Write` | UART |
| `blocking::i2c::Read/Write/WriteRead` | I2C |
| `blocking::spi::Transfer/Write` | SPI |
| `timer::CountDown` | Timer |
| `adc::OneShot` | ADC |

## Three Roles

### 1. HAL Implementation (per microcontroller)

```rust
// stm32f3xx-hal provides this:
impl embedded_hal::digital::v2::OutputPin for PXx<Output<PushPull>> {
    type Error = Infallible;
    fn set_high(&mut self) -> Result<(), Self::Error> {
        // ... hardware register write ...
        Ok(())
    }
    fn set_low(&mut self) -> Result<(), Self::Error> { Ok(()) }
}
```

### 2. Driver (portable, hardware-agnostic)

```rust
// Works on any MCU whose HAL implements OutputPin
use embedded_hal::digital::v2::OutputPin;

pub struct MyLedDriver<PIN: OutputPin> {
    pin: PIN,
}

impl<PIN: OutputPin> MyLedDriver<PIN> {
    pub fn new(pin: PIN) -> Self { Self { pin } }
    pub fn on(&mut self) -> Result<(), PIN::Error> { self.pin.set_high() }
    pub fn off(&mut self) -> Result<(), PIN::Error> { self.pin.set_low() }
}
```

### 3. Application (binds platform to driver)

```rust
// Application is the only part that changes when porting to new hardware
let dp = stm32f3xx_hal::pac::Peripherals::take().unwrap();
let gpioa = dp.GPIOA.split();
let led_pin = gpioa.pa5.into_push_pull_output();

let mut led = MyLedDriver::new(led_pin);
led.on().unwrap();
```

## Notes

- `embedded-hal` supports three HAL implementation sources: real hardware, Linux sysfs, and mock/test adapters
- Embedded systems have no OS and no user-installable software; firmware is compiled as a whole, so only the application layer needs to change per platform
- The `embedded-hal` v1.0 API differs from older v0.2 in error handling (associated `Error` types are now required)
- Check crates.io for `embedded-hal-impl` crates for your specific MCU family

## Related

- [memory-mapped-registers.md](./memory-mapped-registers.md)
- [static-guarantees.md](./static-guarantees.md)
- [design-patterns.md](./design-patterns.md)
