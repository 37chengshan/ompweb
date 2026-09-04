# Traits and Generics

Define shared behavior with traits, write generic functions with trait bounds, and annotate lifetimes.

```rust
use std::fmt::Display;

// Trait with a required method and a default implementation
pub trait Summary {
    fn summarize_author(&self) -> String;

    fn summarize(&self) -> String {
        format!("(Read more from {}...)", self.summarize_author())
    }
}

pub struct NewsArticle {
    pub headline: String,
    pub author: String,
    pub content: String,
}

impl Summary for NewsArticle {
    fn summarize_author(&self) -> String {
        self.author.clone()
    }
    // summarize() uses the default implementation
}

pub struct Tweet {
    pub username: String,
    pub content: String,
}

impl Summary for Tweet {
    fn summarize_author(&self) -> String {
        format!("@{}", self.username)
    }
    fn summarize(&self) -> String {
        format!("{}: {}", self.username, self.content)
    }
}

// Generic function with multiple trait bounds (where clause)
fn notify_all<T>(items: &[T])
where
    T: Summary + Display,
{
    for item in items {
        println!("[notify] {}", item.summarize());
    }
}

// impl Trait in return position (single concrete type)
fn make_tweet(user: &str) -> impl Summary {
    Tweet { username: user.to_string(), content: String::from("hello") }
}

// Lifetime annotation: returned reference lives at least as long as both inputs
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

fn main() {
    let article = NewsArticle {
        headline: String::from("Rust 2024 Released"),
        author: String::from("Alice"),
        content: String::from("..."),
    };
    println!("{}", article.summarize());

    let tweet = make_tweet("bob");
    println!("{}", tweet.summarize());

    let s1 = String::from("long string");
    let result;
    {
        let s2 = String::from("xyz");
        result = longest(s1.as_str(), s2.as_str());
        println!("longest: {result}");
    }
}
```

## Notes

- The orphan rule: you can implement a trait on a type only if either the trait or the type is local to your crate.
- `impl Trait` in function parameters is sugar for a generic bound; in return position it promises a single (unnamed) concrete type.
- Lifetime annotations describe relationships between reference lifetimes — they do not change how long values live.
- Most lifetimes are inferred; explicit annotations are required only when the compiler cannot determine the relationship.
