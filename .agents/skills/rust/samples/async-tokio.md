# Async / Await with Tokio

Write non-blocking I/O with `async`/`await` using the Tokio runtime.

```toml
# Cargo.toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

```rust
use std::time::Duration;
use tokio::time::sleep;

// async fn returns impl Future — lazy until awaited
async fn fetch_data(id: u32) -> String {
    sleep(Duration::from_millis(100)).await; // yield without blocking thread
    format!("data-{id}")
}

#[tokio::main] // macro wraps main in a Tokio runtime
async fn main() {
    // Sequential await
    let result = fetch_data(1).await;
    println!("{result}");

    // Concurrent: run two futures simultaneously, wait for both
    let (a, b) = tokio::join!(fetch_data(2), fetch_data(3));
    println!("{a}, {b}");

    // Spawn a background task
    let handle = tokio::spawn(async {
        sleep(Duration::from_millis(50)).await;
        println!("background task done");
    });
    handle.await.unwrap();

    // Async channel (tokio::sync::mpsc)
    let (tx, mut rx) = tokio::sync::mpsc::channel::<&str>(8);

    tokio::spawn(async move {
        for msg in ["hello", "world"] {
            tx.send(msg).await.unwrap();
        }
    });

    while let Some(msg) = rx.recv().await {
        println!("got: {msg}");
    }
}
```

## Notes

- `#[tokio::main]` is syntactic sugar for `tokio::runtime::Runtime::new().unwrap().block_on(async { ... })`.
- `tokio::join!` runs futures concurrently on the same task; `tokio::spawn` creates an independent task that can run on any thread in the pool.
- `.await` is a yield point — long CPU-bound work between awaits starves other tasks; offload with `tokio::task::spawn_blocking`.
- Rust does not include an async runtime in the standard library; Tokio is the most widely used choice.
