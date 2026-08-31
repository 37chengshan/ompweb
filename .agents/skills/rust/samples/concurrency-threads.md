# Concurrency with Threads

Spawn OS threads, share data via message-passing channels, and synchronize shared state with `Arc<Mutex<T>>`.

```rust
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

fn main() {
    // --- Spawn and join ---
    let handle = thread::spawn(|| {
        for i in 1..=3 {
            println!("spawned thread: {i}");
            thread::sleep(Duration::from_millis(50));
        }
    });
    handle.join().unwrap(); // block until thread finishes

    // --- move closure: transfer ownership to thread ---
    let data = vec![1, 2, 3];
    let h = thread::spawn(move || println!("data: {data:?}"));
    h.join().unwrap();

    // --- Message passing: mpsc channel ---
    let (tx, rx) = mpsc::channel();
    let tx2 = tx.clone(); // multiple producers

    thread::spawn(move || tx.send("hello").unwrap());
    thread::spawn(move || tx2.send("world").unwrap());

    // rx as iterator exits when all senders are dropped
    for msg in rx {
        println!("received: {msg}");
    }

    // --- Shared state: Arc<Mutex<T>> ---
    let counter = Arc::new(Mutex::new(0i32));
    let mut handles = vec![];

    for _ in 0..5 {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            let mut num = c.lock().unwrap(); // blocks until lock acquired
            *num += 1;
        })); // MutexGuard dropped here — lock released automatically
    }

    for h in handles { h.join().unwrap(); }
    println!("counter: {}", *counter.lock().unwrap()); // 5
}
```

## Notes

- `thread::spawn` requires captured values to be `'static`; use `Arc` to share heap data across threads instead of references.
- `send` takes ownership of the value, preventing use-after-send bugs.
- `MutexGuard` implements `Drop`; the lock is released when the guard goes out of scope — no explicit unlock needed.
- Prefer channels (message passing) over shared state when possible; easier to reason about and avoids deadlocks.
