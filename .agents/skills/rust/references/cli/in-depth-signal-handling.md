# In-Depth: Signal Handling

React to OS signals (e.g. Ctrl+C / SIGINT) in a cross-platform way, with options ranging from a simple callback to async streams.

## Signature / Usage

```toml
# Cargo.toml
[dependencies]
ctrlc = "3"
# or for full Unix signal support:
signal-hook = "0.3"
# channel-based (optional helper):
crossbeam-channel = "0.5"
```

```rust
// Simple Ctrl+C handler with ctrlc
ctrlc::set_handler(move || {
    println!("received Ctrl+C!");
}).expect("Error setting Ctrl+C handler");

// Shared flag pattern (safe to check from multiple threads)
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
let running = Arc::new(AtomicBool::new(true));
let r = running.clone();
ctrlc::set_handler(move || { r.store(false, Ordering::SeqCst); })
    .expect("Error setting Ctrl+C handler");
while running.load(Ordering::SeqCst) { /* work */ }

// Full Unix signal support with signal-hook + crossbeam channel
use signal_hook::consts::SIGTERM;
use signal_hook::iterator::Signals;
let mut signals = Signals::new(&[SIGTERM])?;
for sig in signals.forever() {
    println!("Received signal {:?}", sig);
}
```

## Notes

- If your application does not need graceful shutdown, the OS default handling (immediate exit, resource cleanup by the OS) is sufficient — no code needed.
- `ctrlc` is cross-platform (works on Windows via Console Handlers); `signal-hook` is Unix-only but supports all POSIX signals.
- Prefer the **shared `AtomicBool` flag** pattern over `std::process::exit` inside a handler — it lets you clean up resources before exiting.
- When using `tokio`, enable `signal-hook`'s `tokio-support` feature to get a `futures::Stream` of signals instead of a blocking iterator.
- On a second Ctrl+C, the typical convention is to exit immediately regardless of cleanup state.
- Windows: use [Console Handlers](https://docs.microsoft.com/en-us/windows/console/console-control-handlers) or Structured Exception Handling rather than POSIX signals.

## Related

- [in-depth-exit-code.md](./in-depth-exit-code.md)
- [human-communication.md](./human-communication.md)
