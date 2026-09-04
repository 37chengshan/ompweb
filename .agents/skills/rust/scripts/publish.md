# Publish

crates.io へのパッケージ公開・バージョン管理コマンド。

## crates.io へのログイン

```sh
cargo login
```

API トークンの入力を求められる。トークンは `https://crates.io/settings/tokens` で発行する。
認証情報は `~/.cargo/credentials.toml` に保存される。

## ログアウト

```sh
cargo logout
```

## パッケージに含まれるファイルの確認

```sh
cargo package --list
```

## パッケージのドライランによる検証

```sh
cargo publish --dry-run
```

アップロードせずに検証のみを行う。`target/package/` に `.crate` ファイルを生成し、ビルドが通ることを確認する。

## crates.io への公開

> **警告**: 公開したバージョンは削除できない。シークレットや機密情報を含めないこと。

```sh
cargo publish
cargo publish --allow-dirty
cargo publish --registry my-registry
```

## バージョンの yank（非推奨マーク）

```sh
cargo yank --version 1.0.1
cargo yank --version 1.0.1 --undo
```

yank は既存の `Cargo.lock` を壊さないが、新規の依存追加に選択されなくなる。バージョンのコードは残る。

## 所有者の管理

```sh
cargo owner --list
cargo owner --add github-username
cargo owner --remove github-username
cargo owner --add github:org:team-name
cargo owner --remove github:org:team-name
```

## crates.io の検索

```sh
cargo search "json parser"
cargo search serde --limit 20
```

## バイナリのインストール

```sh
cargo install ripgrep
cargo install --version 13.0.0 ripgrep
cargo install --path .
cargo install --git https://github.com/example/crate
cargo install --locked ripgrep
cargo install --root ~/.local ripgrep
```

## インストール済みバイナリのアンインストール

```sh
cargo uninstall ripgrep
```
