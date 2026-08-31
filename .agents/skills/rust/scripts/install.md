# Install

Rust および関連ツールチェーンのインストール・管理コマンド。

## Rust のインストール（Linux / macOS）

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

インストーラーの指示に従って進める。インストール後、PATH を反映するためにシェルを再起動する。

## Rust のインストール（Windows）

`https://win.rustup.rs` から `rustup-init.exe` をダウンロードして実行する。
64-bit: `https://win.rustup.rs/x86_64`、ARM64: `https://win.rustup.rs/aarch64`

## インストールの確認

```sh
rustc --version
cargo --version
```

## Rust のアップデート

```sh
rustup update
```

stable / beta / nightly すべての既インストール済みツールチェーンを最新版に更新する。

## Rust のアンインストール

> **警告**: rustup とすべてのインストール済みツールチェーン・バイナリを削除する。元に戻せない。

```sh
rustup self uninstall
```

## ツールチェーンの追加インストール

```sh
rustup toolchain install stable
rustup toolchain install beta
rustup toolchain install nightly
rustup toolchain install nightly-2024-01-01
```

## ツールチェーンの一覧表示

```sh
rustup show
```

## デフォルトツールチェーンの設定

```sh
rustup default stable
rustup default nightly
```

## コンポーネントの追加

```sh
rustup component add rust-src
rustup component add rust-docs
rustup component add rustfmt
rustup component add clippy
rustup component add llvm-tools
```

## インストール済みコンポーネントの一覧

```sh
rustup component list
```

## クロスコンパイル用ターゲットの追加

```sh
rustup target add thumbv7em-none-eabihf   # Cortex-M4F（組み込み）
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-unknown-linux-musl
rustup target add wasm32-unknown-unknown
```

## ディレクトリ単位のツールチェーンオーバーライド

```sh
rustup override set nightly
rustup override set 1.80.0
rustup override unset
```

## ローカルドキュメントを開く

```sh
rustup doc
```

## シェル補完スクリプトの生成

```sh
rustup completions bash
rustup completions zsh
rustup completions fish
rustup completions powershell
```
