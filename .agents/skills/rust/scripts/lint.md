# Lint

コード品質チェック・フォーマット・静的解析コマンド。

## コードフォーマット

```sh
cargo fmt
```

`rustfmt` を使ってすべてのソースファイルを整形する。

## フォーマットチェックのみ（変更なし）

```sh
cargo fmt -- --check
```

CI 等でフォーマット違反を検出するときに使用する。終了コード 1 を返す。

## Clippy によるリント実行

```sh
cargo clippy
```

追加のリント警告を出力する。Clippy は `rustup component add clippy` で追加する。

## Clippy をエラーとして扱う（CI 向け）

```sh
cargo clippy -- -D warnings
```

すべての警告をエラーに昇格させる。

## 特定の Clippy リントを許可

```sh
cargo clippy -- -A clippy::needless_return
```

## ワークスペース全体への適用

```sh
cargo clippy --workspace
cargo fmt --all
```

## 将来の互換性警告の確認

```sh
cargo report future-incompatibilities
```

## エラーチェック（成果物なし）

```sh
cargo check
cargo check --workspace
cargo check --all-targets
```

`cargo build` より高速。コンパイルエラーの確認に使用する。

## エディション移行の自動修正

```sh
cargo fix --edition
```

ソースコードを対象エディションに対応する形へ自動書き換えする。その後 `Cargo.toml` の `edition` フィールドを手動で更新する。

## 警告の自動修正

```sh
cargo fix
```

コンパイラが提案する修正を自動適用する。
