# Chapter 17: Fundamentals of Asynchronous Programming: Async, Await, Futures, and Streams

Rust's async/await model for writing concurrent I/O-bound programs without blocking threads.

## Core Concepts

| Term | Meaning |
|------|---------|
| **Future** | A value representing work that may not be done yet; produced by `async` functions |
| **async** | Keyword marking a function or block as asynchronous |
| **await** | Postfix keyword; pauses execution until the future is ready |
| **Runtime** | External library (e.g., Tokio) that polls and drives futures to completion |

Futures are **lazy** — they do nothing until awaited.

## Async Functions and Await

```rust
async fn page_title(url: &str) -> Option<String> {
    // .await is postfix — enables chaining
    let response_text = trpl::get(url).await.text().await;
    Html::parse(&response_text)
        .select_first("title")
        .map(|t| t.inner_html())
}

// An async fn is syntactic sugar for:
fn page_title(url: &str) -> impl Future<Output = Option<String>> {
    async move { /* body */ }
}
```

## Running Async Code

`main` cannot be `async`. Use a runtime's block-on entry point:

```rust
fn main() {
    trpl::block_on(async {
        let title = page_title("https://example.com").await;
        println!("{title:?}");
    })
}
```

## Concurrency with Multiple Futures

```rust
// Join: run two futures concurrently, wait for both
let (result1, result2) = trpl::join(future1, future2).await;

// join! macro for arbitrary number of futures (known at compile time)
trpl::join!(fut_a, fut_b, fut_c);

// select: race futures, return whichever finishes first
match trpl::select(fut1, fut2).await {
    Either::Left(val)  => println!("First: {val:?}"),
    Either::Right(val) => println!("Second: {val:?}"),
}
```

## Spawning Tasks

```rust
let handle = trpl::spawn_task(async {
    for i in 1..10 {
        println!("task: {i}");
        trpl::sleep(Duration::from_millis(500)).await;
    }
});
handle.await.unwrap();
```

## Yielding Control

Within a single async block, code runs synchronously between await points. Long-running work between awaits starves other futures:

```rust
// Yield control to the runtime explicitly
trpl::yield_now().await; // preferred over sleep for yielding
```

## Async Channels

```rust
let (tx, mut rx) = trpl::channel();

let sender = async move {
    for msg in ["hello", "world"] {
        tx.send(msg).unwrap();
        trpl::sleep(Duration::from_millis(500)).await;
    }
};

let receiver = async {
    while let Some(msg) = rx.recv().await {
        println!("Got: {msg}");
    }
};

trpl::join(sender, receiver).await;
```

## Building Abstractions

```rust
async fn timeout<F: Future>(fut: F, max: Duration) -> Result<F::Output, Duration> {
    match trpl::select(fut, trpl::sleep(max)).await {
        Either::Left(output) => Ok(output),
        Either::Right(_)     => Err(max),
    }
}
```

## Async vs. Threads

| | Threads | Async |
|-|---------|-------|
| Concurrency model | OS-scheduled, preemptive | Cooperative (yields at await) |
| Overhead | High (stack per thread) | Low (state machine per future) |
| Best for | CPU-bound, parallel work | I/O-bound, many concurrent tasks |
| Data sharing | `Arc<Mutex<T>>` | Often avoidable via message passing |

They are **complementary**: many async runtimes (e.g., Tokio) use thread pools internally.

## Notes

- Rust does not include an async runtime in the standard library — choose one (Tokio, async-std, smol).
- Each await point is where the compiler generates a state machine transition.
- `move` async blocks transfer ownership of captured variables.
- Streams (async iterators) are covered later in the chapter and allow processing sequences of asynchronously produced values.

## Related

- [Chapter 16: Fearless Concurrency](./16-fearless-concurrency.md)
- [Chapter 13: Iterators and Closures](./13-iterators-closures.md)
