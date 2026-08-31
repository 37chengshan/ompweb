# Flow of Control

Rust provides `if`/`else`, `loop`, `while`, `for`, `match`, `if let`, `let else`, and `while let`. Most are expressions that return a value.

## if / else

```rust
fn main() {
    let n = 5;
    if n < 0 {
        println!("negative");
    } else if n > 0 {
        println!("positive");
    } else {
        println!("zero");
    }

    // if as expression
    let big_n = if n < 10 { 10 * n } else { n / 2 };
}
```

## loop

```rust
fn main() {
    let mut count = 0u32;
    loop {
        count += 1;
        if count == 3 { continue; }
        if count == 5 { break; }
    }

    // loop returns a value
    let result = loop {
        count += 1;
        if count == 10 { break count * 2; }
    };
}
```

## while / while let

```rust
fn main() {
    let mut n = 1;
    while n < 101 { n *= 2; }

    // while let: loop while pattern matches
    let mut stack = vec![1, 2, 3];
    while let Some(top) = stack.pop() {
        println!("{}", top);
    }
}
```

## for and ranges

```rust
fn main() {
    for n in 1..=5 {     // inclusive range
        println!("{}", n);
    }

    let names = vec!["Alice", "Bob"];
    for name in names.iter() {
        println!("{}", name);
    }
}
```

## match

```rust
fn main() {
    let number = 13;
    match number {
        1          => println!("One!"),
        2 | 3 | 5  => println!("Prime"),
        13..=19    => println!("Teen"),
        _          => println!("Other"),
    }

    // match as expression
    let boolean = true;
    let binary = match boolean { false => 0, true => 1 };
}
```

## if let / let else

```rust
fn main() {
    let opt: Option<i32> = Some(7);

    // if let — concise single-pattern match
    if let Some(i) = opt {
        println!("Got {}", i);
    }

    // let else — bind or diverge (break/return/panic)
    let Some(value) = opt else {
        panic!("No value");
    };
    println!("{}", value);
}
```

## Notes

- `match` must be exhaustive — all cases must be covered.
- Labeled loops (`'outer: loop`) allow `break 'outer` to exit nested loops.
- `for` loop: `iter()` borrows, `into_iter()` consumes, `iter_mut()` mutably borrows.

## Related

- [07-expressions.md](./07-expressions.md)
- [03-custom-types.md](./03-custom-types.md)
