# Introduction

The Embedded Rust Book is an introductory guide to using Rust on bare-metal embedded systems, particularly microcontrollers. It combines Rust's safety and zero-cost abstractions with embedded development practices.

## Target Audience

- Developers with embedded experience (C/C++/Ada) who want to adopt Rust
- Rust developers who want to move into embedded systems
- Prerequisites: comfortable writing Rust on desktop; familiar with cross compilation, memory-mapped peripherals, interrupts, and common interfaces (I2C, SPI, Serial)

## Scope

The book covers:
1. Setting up an embedded Rust development environment
2. Best practices for embedded Rust development
3. Practical cookbook patterns (e.g., mixing C and Rust)

Examples use the **STM32F3DISCOVERY** board (ARM Cortex-M4F).

## Key Resource Map

| Topic | Resource |
|-------|----------|
| Rust basics | [The Rust Book](https://doc.rust-lang.org/book/) |
| Beginner embedded | [Discovery Book](https://docs.rust-embedded.org/discovery/) |
| Advanced details | [Embedonomicon](https://docs.rust-embedded.org/embedonomicon/) |
| Embedded FAQ | [Embedded FAQ](https://docs.rust-embedded.org/faq.html) |
| Google training | [Comprehensive Rust: Bare Metal](https://google.github.io/comprehensive-rust/bare-metal.html) |

## Notes

- Read front-to-back; later chapters build on earlier concepts
- Code examples: MIT or Apache 2.0 license
- Prose/images: Creative Commons CC-BY-SA v4.0
- Available translations: Japanese, Chinese

## Related

- [installation.md](./installation.md)
- [no-std.md](./no-std.md)
