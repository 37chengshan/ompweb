# Concurrency

Embedded concurrency arises from interrupt handlers, which run asynchronously alongside the main loop. Rust's ownership model prevents data races, but shared mutable state between ISRs and main code requires careful design.

## No-Concurrency Baseline

```rust
#[entry]
fn main() {
    let peripherals = setup_peripherals();
    loop {
        let inputs = read_inputs(&peripherals);
        let outputs = process(inputs);
        write_outputs(&peripherals, outputs);
    }
}
```

Safe by design — no interrupts, no shared state.

## The Problem: `static mut` is Unsafe

```rust
static mut COUNTER: u32 = 0;

#[interrupt]
fn timer() { unsafe { COUNTER = 0; } }

// DANGER: increment is not atomic (load → add → store can be interrupted)
fn main_loop() { unsafe { COUNTER += 1; } }
```

## Critical Sections

Disable interrupts around non-atomic accesses:

```rust
use cortex_m::interrupt;

interrupt::free(|_| {
    unsafe { COUNTER += 1 };
});
```

Trade-off: increases code size and interrupt latency; not safe on multi-core.

## Atomic Operations (Cortex-M3+)

```rust
use core::sync::atomic::{AtomicUsize, Ordering};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

// Main loop — safe, no unsafe needed
COUNTER.fetch_add(1, Ordering::Relaxed);

// ISR
COUNTER.store(0, Ordering::Relaxed);
```

Works on multi-core; preferred when the target supports atomics.

## Mutex for Non-Copy Types

Use `cortex_m::interrupt::Mutex<Cell<T>>` for simple values:

```rust
use core::cell::Cell;
use cortex_m::interrupt::{self, Mutex};

static COUNTER: Mutex<Cell<u32>> = Mutex::new(Cell::new(0));

interrupt::free(|cs| {
    COUNTER.borrow(cs).set(COUNTER.borrow(cs).get() + 1)
});
```

## Sharing Peripherals Across ISR and Main

```rust
use core::cell::RefCell;
use cortex_m::interrupt::{self, Mutex};
use stm32f4::stm32f405;

static MY_GPIO: Mutex<RefCell<Option<stm32f405::GPIOA>>> =
    Mutex::new(RefCell::new(None));

#[entry]
fn main() -> ! {
    let dp = stm32f405::Peripherals::take().unwrap();
    interrupt::free(|cs| MY_GPIO.borrow(cs).replace(Some(dp.GPIOA)));

    loop {
        interrupt::free(|cs| {
            let gpioa = MY_GPIO.borrow(cs).borrow();
            gpioa.as_ref().unwrap().odr.modify(|_, w| w.odr1().set_bit());
        });
    }
}

#[interrupt]
fn timer() {
    interrupt::free(|cs| {
        let gpioa = MY_GPIO.borrow(cs).borrow();
        gpioa.as_ref().unwrap().odr.modify(|_, w| w.odr1().clear_bit());
    });
}
```

## Send and Sync in Embedded Context

- Interrupts are treated as separate execution threads
- Data shared with an ISR must implement `Sync`
- Moving data to an ISR requires `Send`

## Advanced Alternatives

| Approach | Description |
|----------|-------------|
| RTIC | Statically-analyzed priorities; no critical-section overhead |
| FreeRTOS / ChibiOS bindings | Full RTOS with threads and OS mutexes |
| Atomic instructions | Preferred for multi-core; no interrupt disable needed |

## Notes

- `cortex_m::interrupt::free()` provides a `CriticalSection` token; APIs that require a CS token prove they run inside a critical section
- `Mutex<RefCell<Option<T>>>` is the standard pattern for peripheral sharing; the `Option` allows late initialization
- On multi-core systems, critical sections are insufficient; use atomics or hardware synchronization primitives

## Related

- [peripherals.md](./peripherals.md)
- [static-guarantees.md](./static-guarantees.md)
