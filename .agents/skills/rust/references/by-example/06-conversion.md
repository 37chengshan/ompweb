# Conversion

Rust uses traits to handle type conversion between custom types. The primary traits are `From`/`Into` (infallible) and `TryFrom`/`TryInto` (fallible). String conversion uses `ToString`/`FromStr`.

## From and Into

Implement `From<T>` and `Into` is automatically derived (but not vice versa).

```rust
use std::convert::From;

#[derive(Debug)]
struct Number {
    value: i32,
}

impl From<i32> for Number {
    fn from(item: i32) -> Self {
        Number { value: item }
    }
}

fn main() {
    // Using From
    let num = Number::from(30);
    println!("{:?}", num);

    // Using Into (requires type annotation)
    let num: Number = 5i32.into();
    println!("{:?}", num);

    // Standard library From: &str -> String
    let s = String::from("hello");
}
```

## TryFrom and TryInto

For conversions that may fail, returning `Result`.

```rust
use std::convert::TryFrom;

#[derive(Debug, PartialEq)]
struct EvenNumber(i32);

impl TryFrom<i32> for EvenNumber {
    type Error = ();

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        if value % 2 == 0 {
            Ok(EvenNumber(value))
        } else {
            Err(())
        }
    }
}

fn main() {
    assert_eq!(EvenNumber::try_from(8), Ok(EvenNumber(8)));
    assert_eq!(EvenNumber::try_from(5), Err(()));
}
```

## ToString and FromStr

```rust
use std::str::FromStr;

fn main() {
    // ToString via Display trait
    let s = 42.to_string();

    // Parse string to type
    let n: i32 = "42".parse().unwrap();
    let n = i32::from_str("42").unwrap();
}
```

## Notes

- Implementing `From<T> for U` automatically provides `Into<U> for T`.
- `TryFrom`/`TryInto` return `Result<T, Error>` — use when conversion can logically fail.
- Implement `fmt::Display` to get `to_string()` for free via the blanket `ToString` impl.

## Related

- [05-types.md](./05-types.md)
- [16-traits.md](./16-traits.md)
