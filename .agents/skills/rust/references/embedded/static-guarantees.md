# Static Guarantees

Rust's type system can encode hardware state, enforcing correct peripheral usage at compile time with zero runtime overhead. This eliminates entire classes of bugs present in C embedded code.

## Core Idea: Typestate Programming

Encode the current state of an object into its *type*. Different types represent different states; invalid operations simply don't compile.

### Builder Pattern Example

```rust
pub struct FooBuilder { a: u32, b: u32 }
pub struct Foo { inner: u32 }

impl FooBuilder {
    pub fn new(starter: u32) -> Self { Self { a: starter, b: starter } }
    pub fn double_a(self) -> Self { Self { a: self.a * 2, b: self.b } }
    pub fn into_foo(self) -> Foo { Foo { inner: self.a + self.b } }
}

let x = FooBuilder::new(10).double_a().into_foo();
// Cannot call double_a() after into_foo() — type enforces this
```

## GPIO Typestate Example

```rust
// Marker types — zero-sized, no runtime cost
struct Disabled;
struct Enabled;
struct Output;
struct Input;
struct HighZ;

struct GpioConfig<ENABLED, DIRECTION, MODE> {
    periph: GPIO_CONFIG,
    _enabled: core::marker::PhantomData<ENABLED>,
    _direction: core::marker::PhantomData<DIRECTION>,
    _mode: core::marker::PhantomData<MODE>,
}

// Transition method available on any state
impl<EN, DIR, IN_MODE> GpioConfig<EN, DIR, IN_MODE> {
    pub fn into_enabled_input(self) -> GpioConfig<Enabled, Input, HighZ> {
        self.periph.modify(|_r, w| {
            w.enable.enabled().direction.input().input_mode.high_z()
        });
        GpioConfig { periph: self.periph, .. }
    }
}

// set_bit() only exists for output pins — compile error to call on input
impl GpioConfig<Enabled, Output, DontCare> {
    pub fn set_bit(&mut self, set_high: bool) {
        self.periph.modify(|_r, w| w.output_mode.set_bit(set_high));
    }
}
```

## Design Contracts: Runtime vs Compile-Time

### With runtime checking (fragile)

```rust
pub fn set_direction(&mut self, is_output: bool) -> Result<(), ()> {
    if self.periph.read().enable().bit_is_clear() {
        return Err(());  // runtime check, runtime overhead
    }
    self.periph.modify(|_r, w| w.direction().set_bit(is_output));
    Ok(())
}
```

### With typestate (zero-cost)

```rust
// set_direction() only exists on GpioConfig<Enabled, ...>
// Calling it on a disabled pin is a compile error — no runtime check needed
```

## Key Properties

| Property | Runtime Checking | Typestate |
|----------|-----------------|-----------|
| Safety enforcement | At runtime (panics/errors) | At compile time |
| Performance overhead | Yes (branch + error handling) | Zero |
| Misuse feedback | Runtime panic or Err | Compile error |
| API discoverability | Requires reading docs | Type signatures guide usage |

## Notes

- Zero-sized type markers (`PhantomData<T>`) add no runtime size or overhead
- Ownership rules apply: consuming `self` in a transition prevents reuse of the old state
- This pattern appears throughout `embedded-hal` GPIO traits
- The `Send` and `Sync` traits extend these guarantees to multi-threaded/interrupt contexts

## Related

- [peripherals.md](./peripherals.md)
- [portability.md](./portability.md)
- [memory-mapped-registers.md](./memory-mapped-registers.md)
