---
name: rust
description: >
  Rust 言語リファレンス。
  別名: rustlang, rs (拡張子)、Rust-lang。
  TRPL (The Rust Programming Language)、Rust by Example、Reference、
  Cargo Book、rustc Book、rustdoc Book、Rustonomicon (Unsafe Rust)、
  Edition Guide、Standard Library、Error Index。
  所有権、ライフタイム、トレイト、async / await、エラーハンドリング、マクロ。
user-invocable: false
model: sonnet
---

# Rust リファレンス

Rust — システムプログラミング言語。所有権・借用・ライフタイム・型システムによりメモリ安全性とスレッド安全性を保証する。
公式ドキュメント (doc.rust-lang.org) から主要 14 リソースを構造化。
言語仕様・コード記述・ビルド（Cargo）・Unsafe Rust・組込み・CLI 開発時に参照する。

## ディレクトリ構成

```text
skills/rust/
  SKILL.md
  references/
    book/
      README.md
      01-getting-started.md
      02-guessing-game.md
      03-common-programming-concepts.md
      04-ownership.md
      05-structs.md
      06-enums-and-pattern-matching.md
      07-packages-crates-modules.md
      08-common-collections.md
      09-error-handling.md
      10-generic-types-traits-lifetimes.md
      11-testing.md
      12-io-project.md
      13-iterators-closures.md
      14-cargo-crates-io.md
      15-smart-pointers.md
      16-fearless-concurrency.md
      18-oop.md
      19-patterns-and-matching.md
      20-advanced-features.md
      21-final-project.md
    by-example/
      README.md
      01-hello-world.md
      02-primitives.md
      03-custom-types.md
      04-variable-bindings.md
      05-types.md
      06-conversion.md
      07-expressions.md
      08-flow-of-control.md
      09-functions.md
      10-modules.md
      11-crates.md
      12-cargo.md
      13-attributes.md
      14-generics.md
      15-scoping-rules.md
      16-traits.md
      17-macros.md
      18-error-handling.md
      19-std-library-types.md
      20-std-misc.md
      21-testing.md
      22-unsafe-operations.md
      23-compatibility.md
      24-meta.md
    reference/
      README.md
      abi.md
      attributes.md
      behavior-considered-undefined.md
      conditional-compilation.md
      const-evaluation.md
      crates-and-source-files.md
      influences.md
      inline-assembly.md
      items.md
      lexical-structure.md
      linkage.md
      macros.md
      memory-model.md
      names.md
      notation.md
      patterns.md
      runtime.md
      special-types-and-traits.md
      statements-and-expressions.md
      type-system.md
      unsafety.md
    cargo/
      README.md
      cargo-guide.md
      commands.md
      faq.md
      getting-started.md
      reference-build-scripts.md
      reference-cargo-toml.md
      reference-config.md
      reference-environment-variables.md
      reference-external-tools.md
      reference-features.md
      reference-lints.md
      reference-manifest.md
      reference-overriding-dependencies.md
      reference-profiles.md
      reference-publishing.md
      reference-registries.md
      reference-registry-auth.md
      reference-resolver.md
      reference-semver.md
      reference-source-replacement.md
      reference-specifying-dependencies.md
      reference-unstable.md
      reference-workspaces.md
    rustc/
      README.md
      check-cfg.md
      codegen-options.md
      command-line-arguments.md
      contributing.md
      exploit-mitigations.md
      instrument-coverage.md
      jobserver.md
      json.md
      linker-plugin-lto.md
      lints.md
      platform-support.md
      profile-guided-optimization.md
      remap-path-prefix.md
      sanitizers.md
      symbol-mangling.md
      targets.md
      tests.md
    rustdoc/
      README.md
      advanced-features.md
      attributes.md
      command-line.md
      documentation-tests.md
      how-to-read.md
      how-to-write.md
      linking-to-items-by-name.md
      lints.md
      passes.md
      references.md
      scraped-examples.md
      unstable-features.md
      what-is-rustdoc.md
    nomicon/
      README.md
      atomics.md
      beneath-std.md
      concurrency.md
      conversions.md
      data-layout.md
      ffi.md
      implementing-arc-and-mutex.md
      implementing-vec.md
      meet-safe-and-unsafe.md
      other-reprs.md
      ownership-based-resource-management.md
      ownership.md
      uninitialized.md
      unwinding.md
    edition-guide/
      README.md
      creating-new-project.md
      rust-2015.md
      rust-2018.md
      rust-2021.md
      rust-2024.md
      transitioning-existing-project.md
      what-is-edition.md
    cli/
      README.md
      config-files.md
      error-handling.md
      human-communication.md
      in-depth-exit-code.md
      in-depth-human-communication.md
      in-depth-signal-handling.md
      machine-communication.md
      packaging-distribution.md
      parsing-arguments.md
      project-setup.md
      testing.md
    embedded/
      README.md
      appendix.md
      collections.md
      concurrency.md
      design-patterns.md
      installation.md
      interoperability.md
      intro.md
      memory-mapped-registers.md
      no-std.md
      peripherals.md
      portability.md
      static-guarantees.md
      tips-for-embedded-c-devs.md
      unsorted.md
    stdlib/
      README.md
      module-categories.md
      overview.md
    errors/
      README.md
      error-categories.md
    unstable/
      README.md
      feature-categories.md
    rustlings/
      README.md
      overview.md
  samples/
    README.md
    async-tokio.md
    collections.md
    concurrency-threads.md
    enums-and-pattern-matching.md
    error-handling.md
    iterators-and-closures.md
    ownership-and-borrowing.md
    structs-and-methods.md
    testing.md
    traits-and-generics.md
  scripts/
    README.md
    build.md
    dependencies.md
    generate.md
    install.md
    lint.md
    publish.md
    test.md
```

## 探索手順

タスクからカテゴリを引き、カテゴリの README.md で目的のページを特定する:

1. 下記マッピング表でタスクに対応するカテゴリを探す
2. そのカテゴリの `references/{category}/README.md` を参照して目的のページを特定する
3. 該当ページの `.md` を Read して詳細を確認する

## タスク → カテゴリ マッピング

| タスク | カテゴリ | 参照 README |
|--------|---------|------------|
| 言語入門・所有権・借用・ライフタイム・構造体・Enum・トレイト・ジェネリクス・並行性・async を学ぶ | book | [references/book/README.md](references/book/README.md) |
| 言語機能をコード例で素早く確認する、構文のクイックリファレンス | by-example | [references/by-example/README.md](references/by-example/README.md) |
| 厳密な言語仕様・構文・型システム・メモリモデル・ABI・UB 定義を調べる | reference | [references/reference/README.md](references/reference/README.md) |
| Cargo.toml, Workspaces, Features, Profiles, 依存関係指定, crates.io 公開を調べる | cargo | [references/cargo/README.md](references/cargo/README.md) |
| rustc コンパイラオプション, lint, target, sanitizer, PGO, LTO を調べる | rustc | [references/rustc/README.md](references/rustc/README.md) |
| ドキュメント生成, doctest, doc コメント記法, intra-doc links を調べる | rustdoc | [references/rustdoc/README.md](references/rustdoc/README.md) |
| Unsafe Rust, FFI, unsound パターン, Vec/Arc 実装, アトミックを調べる | nomicon | [references/nomicon/README.md](references/nomicon/README.md) |
| Rust 2015/2018/2021/2024 エディション差分・移行方法を調べる | edition-guide | [references/edition-guide/README.md](references/edition-guide/README.md) |
| CLI アプリ開発, clap, 終了コード, シグナル処理を調べる | cli | [references/cli/README.md](references/cli/README.md) |
| 組込み開発, no_std, HAL, peripheral, memory-mapped registers を調べる | embedded | [references/embedded/README.md](references/embedded/README.md) |
| 標準ライブラリのモジュール構成, Collections, I/O, Concurrency 概要を調べる | stdlib | [references/stdlib/README.md](references/stdlib/README.md) |
| コンパイラエラーコード（E0XXX）の参照方法・代表例を調べる | errors | [references/errors/README.md](references/errors/README.md) |
| Nightly 限定機能, feature フラグ, -Z フラグを調べる | unstable | [references/unstable/README.md](references/unstable/README.md) |
| Rustlings 演習環境・学習ワークフローを調べる | rustlings | [references/rustlings/README.md](references/rustlings/README.md) |
| 典型的な使い方を知りたい（所有権・async・エラー処理・コレクション等） | samples | [samples/README.md](samples/README.md) |
| インストール・ビルド・テスト・lint・依存管理・公開コマンドを知りたい | scripts | [scripts/README.md](scripts/README.md) |
