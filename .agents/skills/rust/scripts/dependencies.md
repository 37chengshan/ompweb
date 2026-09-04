# Dependencies

依存関係の追加・削除・更新・調査コマンド。

## 依存関係の追加

```sh
cargo add serde
cargo add serde --features derive
cargo add serde@1.0.100
cargo add --dev tempfile
cargo add --build cc
cargo add --path ../my-crate
cargo add --git https://github.com/example/crate
```

## 依存関係の削除

```sh
cargo remove serde
```

## 依存関係のアップデート

```sh
cargo update
cargo update -p regex
cargo update --precise regex 1.9.0
cargo update --recursive
```

`cargo update` は `Cargo.lock` を更新する。`Cargo.toml` の依存バージョン範囲内で最新を選択する。

## 依存ツリーの表示

```sh
cargo tree
cargo tree -e features
cargo tree --duplicates
cargo tree -i <crate>
cargo tree -p <package>
cargo tree --workspace
cargo tree -f "{p} {f}"
```

## フィーチャーエッジの確認

```sh
cargo tree -e features -i serde
```

特定クレートの features が何から有効化されているかを調べる。

## 依存関係のベンダリング（ローカルコピー）

> **警告**: `vendor/` ディレクトリに全依存のソースをコピーする。ディスク容量が増加する。

```sh
cargo vendor
cargo vendor --sync Cargo.toml
```

ベンダリング後は `.cargo/config.toml` に以下を追記する:

```toml
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
```

## 依存関係のフェッチ（ビルドなし）

```sh
cargo fetch
```

ネットワークなし環境での事前ダウンロードに使用する。

## プロジェクトメタデータの確認（JSON）

```sh
cargo metadata --format-version 1
```

パッケージリスト・依存グラフ・ワークスペース情報を JSON 出力する。

## ロックファイルの生成・更新

```sh
cargo generate-lockfile
```
