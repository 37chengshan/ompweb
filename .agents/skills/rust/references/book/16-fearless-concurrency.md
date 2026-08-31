# Chapter 16: Fearless Concurrency

Rust's ownership and type system prevent data races and many concurrency bugs at compile time.

## Threads

```rust
use std::thread;
use std::time::Duration;

// Spawn a thread
let handle = thread::spawn(|| {
    for i in 1..10 {
        println!("hi {i} from spawned thread");
        thread::sleep(Duration::from_millis(1));
    }
});

// Join: block until the thread finishes
handle.join().unwrap();
```

- When the main thread ends, all spawned threads are killed regardless of completion.
- Use `move` closures to transfer ownership of captured values to the thread:

```rust
let v = vec![1, 2, 3];
let handle = thread::spawn(move || println!("{v:?}"));
handle.join().unwrap();
```

## Message Passing — Channels

```rust
use std::sync::mpsc; // multiple producer, single consumer
use std::thread;

let (tx, rx) = mpsc::channel();

// Multiple producers via clone
let tx2 = tx.clone();

thread::spawn(move || {
    tx.send(String::from("hello")).unwrap();
});
thread::spawn(move || {
    tx2.send(String::from("world")).unwrap();
});

// Receive: blocks until a message arrives
for msg in rx { // rx as iterator: exits when all senders are dropped
    println!("Got: {msg}");
}
```

- `send` takes ownership of the value — prevents use-after-send bugs.
- `rx.recv()` blocks; `rx.try_recv()` returns immediately with `Ok` or `Err`.
- The channel closes when all `tx` handles are dropped, ending `for msg in rx`.

## Shared State — Mutex\<T\> + Arc\<T\>

```rust
use std::sync::{Arc, Mutex};
use std::thread;

let counter = Arc::new(Mutex::new(0));
let mut handles = vec![];

for _ in 0..10 {
    let counter = Arc::clone(&counter);
    let handle = thread::spawn(move || {
        let mut num = counter.lock().unwrap(); // blocks until lock acquired
        *num += 1;
    }); // MutexGuard dropped here, lock released
    handles.push(handle);
}

for h in handles { h.join().unwrap(); }
println!("Result: {}", *counter.lock().unwrap()); // 10
```

- `Mutex::lock()` returns a `MutexGuard<T>` — automatically released when it goes out of scope.
- `Arc<T>` (Atomic Reference Counting): thread-safe version of `Rc<T>`.
- A poisoned mutex (thread panicked while holding the lock) causes `lock()` to return `Err`.

## Send and Sync Marker Traits

| Trait | Meaning |
|-------|---------|
| `Send` | Safe to transfer ownership between threads |
| `Sync` | Safe for multiple threads to hold a reference simultaneously (`&T: Send`) |

- Almost all primitive types are both `Send` and `Sync`.
- `Rc<T>`: neither `Send` nor `Sync` — use `Arc<T>` for threads.
- `RefCell<T>`: `Send` but not `Sync` — use `Mutex<T>` for threads.
- Implementing `Send` or `Sync` manually requires `unsafe` and careful reasoning.

## Notes

- Deadlocks are possible with `Mutex` (e.g., two threads each waiting for the other's lock). Rust cannot prevent them at compile time.
- Prefer channels (message passing) over shared state when possible — it's easier to reason about.
- `thread::spawn` requires `'static` lifetimes for closures; use `Arc` to share data instead of references.

## Related

- [Chapter 15: Smart Pointers](./15-smart-pointers.md)
- [Chapter 17: Async and Await](./17-async-await.md)
