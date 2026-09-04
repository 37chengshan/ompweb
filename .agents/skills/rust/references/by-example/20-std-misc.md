# Std Misc

Additional standard library features for concurrency, file I/O, processes, and inter-process communication.

## Threads

```rust
use std::thread;

const NTHREADS: u32 = 10;

fn main() {
    let mut handles = vec![];

    for i in 0..NTHREADS {
        handles.push(thread::spawn(move || {
            println!("thread {}", i);
        }));
    }

    for h in handles {
        h.join().unwrap(); // wait for each thread
    }
}
```

## Channels — Message Passing

```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        tx.send("hello from thread").unwrap();
    });

    let msg = rx.recv().unwrap();
    println!("{}", msg);
}
```

`mpsc` = multiple producer, single consumer. Clone `tx` for multiple senders.

## File I/O

```rust
use std::fs::{self, File};
use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    // Write a file
    let mut file = File::create("hello.txt")?;
    writeln!(file, "Hello, World!")?;

    // Read entire file
    let content = fs::read_to_string("hello.txt")?;
    println!("{}", content);

    // Read line by line
    let file = File::open("hello.txt")?;
    for line in io::BufReader::new(file).lines() {
        println!("{}", line?);
    }

    // Remove file
    fs::remove_file("hello.txt")?;
    Ok(())
}
```

## Child Processes

```rust
use std::process::{Command, Stdio};

fn main() {
    // Run a command and collect output
    let output = Command::new("echo")
        .arg("hello")
        .output()
        .expect("failed to execute");

    println!("{}", String::from_utf8_lossy(&output.stdout));

    // Pipe output to next process
    let mut child = Command::new("ls")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.wait().unwrap();
}
```

## Filesystem Operations

```rust
use std::fs;
use std::path::Path;

fn main() -> std::io::Result<()> {
    fs::create_dir_all("a/b/c")?;

    if Path::new("a").exists() {
        println!("exists");
    }

    for entry in fs::read_dir(".")? {
        let entry = entry?;
        println!("{:?}", entry.file_name());
    }

    fs::remove_dir_all("a")?;
    Ok(())
}
```

## Notes

- Share mutable state across threads with `Arc<Mutex<T>>` (not shown here — covered in the standard library docs).
- `mpsc::sync_channel(n)` creates a bounded channel with capacity `n`; send blocks when full.
- Use `std::process::exit(code)` to terminate the process immediately.
- `Command::new("prog").stdin(Stdio::piped())` enables piping data into child stdin.

## Related

- [19-std-library-types.md](./19-std-library-types.md)
- [22-unsafe-operations.md](./22-unsafe-operations.md)
