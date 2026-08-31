# Build

プロジェクトのコンパイル・実行・成果物管理コマンド。

## デバッグビルド

```sh
cargo build
```

`target/debug/` に成果物を出力する。

## リリースビルド

```sh
cargo build --release
```

最適化コンパイル。`target/release/` に出力。

## エラーチェックのみ（成果物なし）

```sh
cargo check
```

`cargo build` より高速。開発中の繰り返し確認に推奨。

## 実行

```sh
cargo run
cargo run --bin my-binary
cargo run --example demo
cargo run -- arg1 arg2
```

## クロスコンパイル

```sh
cargo build --target aarch64-unknown-linux-gnu
cargo build --target thumbv7em-none-eabihf
cargo build --target wasm32-unknown-unknown
```

`rustup target add <triple>` でターゲットを事前に追加する。

## 特定パッケージのビルド（ワークスペース）

```sh
cargo build -p <package>
cargo build --workspace
```

## フィーチャーフラグ付きビルド

```sh
cargo build --features "f1 f2"
cargo build --all-features
cargo build --no-default-features
cargo build --no-default-features --features png
```

## カスタムプロファイルでのビルド

```sh
cargo build --profile release-lto
```

`Cargo.toml` に `[profile.release-lto]` を定義した上で使用する。

## ビルド成果物の削除

> **警告**: `target/` ディレクトリ全体を削除する。再ビルドに時間がかかる。

```sh
cargo clean
```

## ビルドオプション（その他）

```sh
cargo build --locked           # Cargo.lock が最新であることを要求
cargo build --offline          # ネットワーク接続なし
cargo build -v                 # 詳細出力
cargo build -vv                # 非常に詳細（ビルドスクリプト出力を含む）
cargo build --message-format=json  # 機械可読な JSON 出力
```

## コンパイラエラーの自動修正

```sh
cargo fix
cargo fix --edition
```

`cargo fix --edition` はエディション移行の自動修正に使用する。

## ドキュメントの生成

```sh
cargo doc
cargo doc --open
cargo doc --no-deps
```
