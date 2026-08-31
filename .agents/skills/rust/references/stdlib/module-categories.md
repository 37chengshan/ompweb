# Standard Library Module Categories

A categorized overview of the most important modules in `std`. Each entry links to its official documentation. Individual method details are not listed here — follow the links.

## Collections

Efficient implementations of common general-purpose data structures.

| Module / Type | Description | Docs |
|---------------|-------------|------|
| `std::collections` | The collection library root | https://doc.rust-lang.org/std/collections/ |
| `HashMap<K, V>` | Hash map with quadratic probing and SIMD lookup | https://doc.rust-lang.org/std/collections/struct.HashMap.html |
| `HashSet<T>` | Hash set implemented as `HashMap<T, ()>` | https://doc.rust-lang.org/std/collections/struct.HashSet.html |
| `BTreeMap<K, V>` | Ordered map based on a B-Tree | https://doc.rust-lang.org/std/collections/struct.BTreeMap.html |
| `BTreeSet<T>` | Ordered set based on a B-Tree | https://doc.rust-lang.org/std/collections/struct.BTreeSet.html |
| `Vec<T>` | Heap-allocated growable array (also in `std::vec`) | https://doc.rust-lang.org/std/vec/struct.Vec.html |
| `VecDeque<T>` | Double-ended queue with growable ring buffer | https://doc.rust-lang.org/std/collections/struct.VecDeque.html |
| `LinkedList<T>` | Doubly-linked list with owned nodes | https://doc.rust-lang.org/std/collections/struct.LinkedList.html |
| `BinaryHeap<T>` | Priority queue implemented with a binary max-heap | https://doc.rust-lang.org/std/collections/struct.BinaryHeap.html |

## Data Handling

Core types for representing optional values, errors, iteration, and text.

| Module | Description | Docs |
|--------|-------------|------|
| `std::option` | `Option<T>` — a value that is either `Some(T)` or `None` | https://doc.rust-lang.org/std/option/ |
| `std::result` | `Result<T, E>` — a value representing success or failure | https://doc.rust-lang.org/std/result/ |
| `std::iter` | The `Iterator` trait and composable iterator adapters | https://doc.rust-lang.org/std/iter/ |
| `std::string` | `String` — owned, heap-allocated, UTF-8 string | https://doc.rust-lang.org/std/string/ |
| `std::vec` | `Vec<T>` — heap-allocated growable array | https://doc.rust-lang.org/std/vec/ |

## Memory

Types and utilities for memory layout, pointer manipulation, and smart pointers.

| Module | Description | Docs |
|--------|-------------|------|
| `std::mem` | Functions for memory size, alignment, and manipulation | https://doc.rust-lang.org/std/mem/ |
| `std::ptr` | Raw pointer operations (`read`, `write`, `copy`, …) | https://doc.rust-lang.org/std/ptr/ |
| `std::pin` | `Pin<P>` — prevents moving a value in memory (required for async) | https://doc.rust-lang.org/std/pin/ |
| `std::rc` | `Rc<T>` — single-threaded reference-counted smart pointer | https://doc.rust-lang.org/std/rc/ |
| `std::sync` | `Arc<T>`, `Mutex<T>`, `RwLock<T>`, and other thread-safe primitives | https://doc.rust-lang.org/std/sync/ |
| `std::cell` | `Cell<T>` / `RefCell<T>` — interior mutability without `unsafe` | https://doc.rust-lang.org/std/cell/ |
| `std::borrow` | `Borrow` / `ToOwned` traits for borrowing and ownership conversion | https://doc.rust-lang.org/std/borrow/ |

## I/O and OS

Abstractions for input/output, file system, paths, and process management.

| Module | Description | Docs |
|--------|-------------|------|
| `std::io` | Core I/O traits (`Read`, `Write`, `BufRead`, `Seek`) and helpers | https://doc.rust-lang.org/std/io/ |
| `std::fs` | File system operations: open, read, write, metadata, permissions | https://doc.rust-lang.org/std/fs/ |
| `std::path` | Cross-platform file path manipulation (`Path`, `PathBuf`) | https://doc.rust-lang.org/std/path/ |
| `std::env` | Process environment: args, env vars, current directory | https://doc.rust-lang.org/std/env/ |
| `std::process` | Process spawning, exit codes, and stdio handling | https://doc.rust-lang.org/std/process/ |
| `std::os` | OS-specific extensions (Unix, Windows, WASI) | https://doc.rust-lang.org/std/os/ |

## Networking

| Module | Description | Docs |
|--------|-------------|------|
| `std::net` | TCP/UDP sockets, IP addresses, socket addresses | https://doc.rust-lang.org/std/net/ |

## Concurrency

Building blocks for multithreaded and concurrent programs.

| Module | Description | Docs |
|--------|-------------|------|
| `std::thread` | Native OS thread spawning, joining, and sleeping | https://doc.rust-lang.org/std/thread/ |
| `std::sync` | `Mutex`, `RwLock`, `Condvar`, `Barrier`, `Arc`, `OnceLock`, … | https://doc.rust-lang.org/std/sync/ |
| `std::sync::atomic` | Lock-free atomic types (`AtomicBool`, `AtomicUsize`, `AtomicPtr`, …) | https://doc.rust-lang.org/std/sync/atomic/ |
| `std::sync::mpsc` | Multi-producer, single-consumer channel (`channel`, `sync_channel`) | https://doc.rust-lang.org/std/sync/mpsc/ |

## Time

| Module | Description | Docs |
|--------|-------------|------|
| `std::time` | `Duration`, `Instant` (monotonic clock), `SystemTime` (wall clock) | https://doc.rust-lang.org/std/time/ |

## Error Handling

| Module | Description | Docs |
|--------|-------------|------|
| `std::error` | The `Error` trait — the standard interface for error types | https://doc.rust-lang.org/std/error/ |
| `std::panic` | Inspect panic info, set/clear panic hooks, catch panics | https://doc.rust-lang.org/std/panic/ |

## FFI (Foreign Function Interface)

Utilities for interoperating with C and other native code.

| Module | Description | Docs |
|--------|-------------|------|
| `std::ffi` | `CStr` / `CString` for C strings; `OsStr` / `OsString` for OS strings | https://doc.rust-lang.org/std/ffi/ |
| `std::os::raw` | C-compatible primitive type aliases (`c_int`, `c_char`, `c_void`, …) | https://doc.rust-lang.org/std/os/raw/ |

## Related

- [overview.md](./overview.md)
