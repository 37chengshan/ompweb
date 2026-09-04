# Chapter 15: Smart Pointers

Data structures that act like pointers but provide additional metadata and capabilities. Implemented via the `Deref` and `Drop` traits.

## Box\<T\> — Heap Allocation

```rust
// Store data on the heap
let b = Box::new(5);
println!("b = {b}"); // Derefs transparently

// Primary use case: recursive types (Box gives known size)
enum List {
    Cons(i32, Box<List>),
    Nil,
}
let list = Cons(1, Box::new(Cons(2, Box::new(Nil))));
```

Use `Box<T>` when:
- Type size is unknown at compile time (recursive types).
- You want to transfer ownership of large data without copying.
- You need a trait object (`Box<dyn Trait>`).

## Rc\<T\> — Reference Counted Multiple Ownership

```rust
use std::rc::Rc;

let a = Rc::new(Cons(5, Rc::new(Nil)));
println!("count = {}", Rc::strong_count(&a)); // 1

let b = Cons(3, Rc::clone(&a)); // increments ref count (cheap)
println!("count = {}", Rc::strong_count(&a)); // 2

{
    let c = Cons(4, Rc::clone(&a));
    println!("count = {}", Rc::strong_count(&a)); // 3
}
println!("count = {}", Rc::strong_count(&a)); // 2 (c dropped)
```

- **Single-threaded only** — not thread-safe.
- `Rc::clone` increments the reference count; it does NOT deep-copy data.
- Data is freed when `strong_count` reaches 0.
- Provides **immutable** shared access only.

## RefCell\<T\> — Interior Mutability

Enforces borrowing rules at **runtime** instead of compile time.

```rust
use std::cell::RefCell;

let data = RefCell::new(vec![1, 2, 3]);
data.borrow_mut().push(4);      // mutable borrow
println!("{:?}", data.borrow()); // immutable borrow

// Panics at runtime if rules are violated:
// let _r1 = data.borrow_mut();
// let _r2 = data.borrow_mut(); // ❌ panic: already mutably borrowed
```

- **Single-threaded only** — use `Mutex<T>` for multi-threading.
- `borrow()` returns `Ref<T>`; `borrow_mut()` returns `RefMut<T>`.
- Useful for mock objects in tests and when you need mutability through a shared reference.

## Rc\<RefCell\<T\>\> — Multiple Owners with Mutation

```rust
use std::rc::Rc;
use std::cell::RefCell;

let value = Rc::new(RefCell::new(5));
let a = Rc::clone(&value);
let b = Rc::clone(&value);

*value.borrow_mut() += 10;
println!("a = {:?}, b = {:?}", a.borrow(), b.borrow()); // both see 15
```

## Weak\<T\> — Preventing Reference Cycles

`Rc::clone` creates strong references; `Rc::downgrade` creates weak references that don't affect the ref count and don't prevent deallocation.

```rust
use std::rc::{Rc, Weak};
use std::cell::RefCell;

struct Node {
    value: i32,
    parent: RefCell<Weak<Node>>,        // weak: child doesn't own parent
    children: RefCell<Vec<Rc<Node>>>,   // strong: parent owns children
}

// Access a weak reference
if let Some(parent) = leaf.parent.borrow().upgrade() {
    println!("parent value: {}", parent.value);
}
```

- `Rc::downgrade(&rc)` → `Weak<T>`
- `weak.upgrade()` → `Option<Rc<T>>` (returns `None` if data was dropped)

## Deref and Drop Traits

```rust
// Deref: lets Box<T> behave like &T
use std::ops::Deref;
impl<T> Deref for MyBox<T> {
    type Target = T;
    fn deref(&self) -> &Self::Target { &self.0 }
}

// Drop: cleanup when value goes out of scope
impl Drop for CustomSmartPointer {
    fn drop(&mut self) { println!("Dropping!"); }
}
// Early drop: std::mem::drop(value);  — cannot call value.drop() directly
```

## Notes

| Type | Ownership | Borrow checking | Thread-safe |
|------|-----------|-----------------|-------------|
| `Box<T>` | Single | Compile-time | Yes (if T: Send) |
| `Rc<T>` | Multiple | Compile-time | No |
| `RefCell<T>` | Single | Runtime | No |
| `Arc<T>` | Multiple | Compile-time | Yes |
| `Mutex<T>` | Single/shared | Runtime (lock) | Yes |

## Related

- [Chapter 4: Understanding Ownership](./04-ownership.md)
- [Chapter 16: Fearless Concurrency](./16-fearless-concurrency.md)
