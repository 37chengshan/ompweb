# Generate

新規プロジェクト・パッケージの作成コマンド。

## バイナリクレートの作成

```sh
cargo new hello_world
cargo new hello_world --bin
```

`src/main.rs` を持つ実行ファイルプロジェクトを生成する。デフォルトで git リポジトリも初期化される。

## ライブラリクレートの作成

```sh
cargo new --lib my-lib
```

`src/lib.rs` を持つライブラリプロジェクトを生成する。

## 既存ディレクトリへの初期化

```sh
cargo init
cargo init --bin
cargo init --lib
```

カレントディレクトリに `Cargo.toml` と `src/` を生成する。

## エディション指定でのプロジェクト作成

```sh
cargo new --edition 2021 my-project
cargo new --edition 2024 my-project
```

省略すると最新の安定エディション（現在は 2024）が使用される。

## VCS 初期化なしでのプロジェクト作成

```sh
cargo new --vcs none my-project
```

git リポジトリの初期化をスキップする。

## テンプレートからのプロジェクト生成（cargo-generate）

```sh
cargo install cargo-generate
cargo generate --git https://github.com/rust-embedded/cortex-m-quickstart
```

`cargo-generate` は crates.io から別途インストールが必要。組み込み開発のテンプレート利用等に使用する。

## 生成されるプロジェクト構造

```
my-project/
├── Cargo.toml
└── src/
    └── main.rs   # バイナリの場合
    └── lib.rs    # ライブラリの場合
```
