# Chapter 21: Final Project — Building a Multithreaded Web Server

A capstone project combining concepts from the entire book: TCP networking, HTTP parsing, thread pools, and graceful shutdown.

## Project Overview

Build `hello` — a minimal HTTP server that:
1. Listens for TCP connections on `127.0.0.1:7878`
2. Parses HTTP GET requests
3. Returns `hello.html` for `/`, `404.html` otherwise
4. Handles connections concurrently via a thread pool of 4 workers

## Single-Threaded Server

```rust
use std::fs;
use std::io::{BufReader, prelude::*};
use std::net::{TcpListener, TcpStream};

fn main() {
    let listener = TcpListener::bind("127.0.0.1:7878").unwrap();
    for stream in listener.incoming() {
        handle_connection(stream.unwrap());
    }
}

fn handle_connection(mut stream: TcpStream) {
    let buf_reader = BufReader::new(&stream);
    let request_line = buf_reader.lines().next().unwrap().unwrap();

    let (status_line, filename) = if request_line == "GET / HTTP/1.1" {
        ("HTTP/1.1 200 OK", "hello.html")
    } else {
        ("HTTP/1.1 404 NOT FOUND", "404.html")
    };

    let contents = fs::read_to_string(filename).unwrap();
    let response = format!(
        "{status_line}\r\nContent-Length: {}\r\n\r\n{contents}",
        contents.len()
    );
    stream.write_all(response.as_bytes()).unwrap();
}
```

## Thread Pool

```rust
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

type Job = Box<dyn FnOnce() + Send + 'static>;

pub struct ThreadPool {
    workers: Vec<Worker>,
    sender: Option<mpsc::Sender<Job>>,
}

impl ThreadPool {
    pub fn new(size: usize) -> Self {
        assert!(size > 0);
        let (sender, receiver) = mpsc::channel();
        let receiver = Arc::new(Mutex::new(receiver));
        let workers = (0..size)
            .map(|id| Worker::new(id, Arc::clone(&receiver)))
            .collect();
        ThreadPool { workers, sender: Some(sender) }
    }

    pub fn execute<F>(&self, f: F)
    where F: FnOnce() + Send + 'static {
        self.sender.as_ref().unwrap().send(Box::new(f)).unwrap();
    }
}

struct Worker {
    id: usize,
    thread: Option<thread::JoinHandle<()>>,
}

impl Worker {
    fn new(id: usize, receiver: Arc<Mutex<mpsc::Receiver<Job>>>) -> Worker {
        let thread = thread::spawn(move || loop {
            let message = receiver.lock().unwrap().recv();
            match message {
                Ok(job) => { println!("Worker {id} executing."); job(); }
                Err(_)  => { println!("Worker {id} shutting down."); break; }
            }
        });
        Worker { id, thread: Some(thread) }
    }
}
```

### Graceful shutdown via Drop

```rust
impl Drop for ThreadPool {
    fn drop(&mut self) {
        drop(self.sender.take()); // close channel → workers receive Err and exit loop

        for worker in &mut self.workers {
            println!("Shutting down worker {}", worker.id);
            if let Some(thread) = worker.thread.take() {
                thread.join().unwrap(); // wait for each worker to finish
            }
        }
    }
}
```

## Multithreaded Server

```rust
fn main() {
    let listener = TcpListener::bind("127.0.0.1:7878").unwrap();
    let pool = ThreadPool::new(4);

    for stream in listener.incoming().take(2) { // limit for demo
        let stream = stream.unwrap();
        pool.execute(|| handle_connection(stream));
    }
    println!("Shutting down.");
} // pool.drop() called here — joins all worker threads
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Fixed thread pool size | Prevents DoS via unlimited thread spawning |
| `mpsc::channel` for jobs | Multiple producers (main) → one receiver per worker |
| `Arc<Mutex<Receiver>>` | Shared ownership + mutual exclusion for lock safety |
| `FnOnce + Send + 'static` | Jobs execute once; cross-thread safe; no borrowed data |
| Lock released before `job()` | Release lock after `recv()` so other workers aren't blocked during execution |
| `Option<Sender>` + `take()` | Allows cleanly closing channel in `Drop` |

## Notes

- Dropping the sender (channel close) causes `recv()` in workers to return `Err`, signaling them to exit their loop — this is the graceful shutdown mechanism.
- The `while let Ok(job) = ...` pattern would hold the mutex lock during job execution, blocking other workers. The `let job = ...; job()` pattern releases it first.
- Port 7878 is "rust" on a telephone keypad.
- For production servers, use an existing crate (e.g., Hyper, Axum) instead of this manual implementation.

## Related

- [Chapter 16: Fearless Concurrency](./16-fearless-concurrency.md)
- [Chapter 15: Smart Pointers](./15-smart-pointers.md)
- [Chapter 13: Iterators and Closures](./13-iterators-closures.md)
