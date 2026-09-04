# Test

テスト・ベンチマークの実行コマンド。

## 全テストの実行

```sh
cargo test
```

ユニットテスト・インテグレーションテスト・ドキュメントテストをすべて実行する。

## 名前でテストを絞り込み

```sh
cargo test foo
cargo test add
```

テスト名に指定文字列が含まれるものだけを実行する。

## テスト対象の限定

```sh
cargo test --lib                    # ライブラリテストのみ
cargo test --test integration       # tests/integration.rs のみ
cargo test --doc                    # ドキュメントテストのみ
cargo test --bins                   # バイナリターゲットのみ
cargo test --examples               # example ターゲットのみ
```

## テスト実行オプション

```sh
cargo test -- --nocapture           # テスト中の println! 出力を表示
cargo test -- --show-output         # 成功したテストの stdout を表示
cargo test -- --test-threads=1      # 直列実行（並列を無効化）
cargo test -- --ignored             # #[ignore] が付いたテストのみ実行
cargo test -- --include-ignored     # 無視マークを含む全テストを実行
```

## ワークスペース全体のテスト

```sh
cargo test --workspace
```

## 特定パッケージのテスト（ワークスペース）

```sh
cargo test -p <package>
```

## ベンチマークの実行

```sh
cargo bench
cargo bench my_bench
```

## テスト用依存関係のフェッチ（ビルドなし）

```sh
cargo fetch
```

オフライン環境での事前準備に使用する。

## テスト向けフィーチャー指定

```sh
cargo test --features "feat1 feat2"
cargo test --all-features
cargo test --no-default-features
```
