# Thunderbird AI Bridge

[English / 全言語一覧](../../README.md)

## これは何ですか？

Thunderbird AI Bridge は、Thunderbird と AI エージェント、CLI ツール、スクリプト、独自アプリケーションをつなぐローカルブリッジです。拡張機能がメールボックス操作を実行し、ローカルプログラムが `127.0.0.1` 上の小さな HTTP プロトコルを通じて通信します。

**SuperCLI は必須ではありません。** 最初の host は SuperCLI 向けに作られましたが、[docs/PROTOCOL.md](../PROTOCOL.md) に記載されたプロトコルを実装すれば、どのプログラムでもこの拡張機能を利用できます。

## 主な機能

- アカウントとフォルダーの一覧取得、
- フォルダーの作成、名前変更、削除、
- 送信者、受信者/アドレス、件名、全文、日付による検索、
- 既読/未読状態を意図的に変更せずにメッセージを読む、
- 長いメッセージを分割して読む、
- vision モデルや文書処理向けに添付ファイルを一覧・転送、
- メッセージの移動、ゴミ箱への移動、復元、
- IMAP 検証付きの完全削除、
- Thunderbird ネイティブの Empty Trash/EXPUNGE、
- Outlook `.msg` を `.eml` に変換した後のインポート、
- continuation token を使った制限付きバッチ処理。

## セキュリティ

重要な操作には追加の保護があります。破壊的操作には `confirm: true` が必要で、完全削除はゴミ箱内に限定され、system/root フォルダーは保護されます。host 側でもユーザーから明確な確認を得てください。

この bridge はローカル利用を前提としています。host を LAN やインターネットへ直接公開しないでください。

## ビルド

Thunderbird 128 以降が必要です。

```bash
python scripts/build_xpi.py
npm test
```

XPI は `dist/thunderbird-ai-bridge.xpi` に生成され、Thunderbird のアドオンマネージャーから手動でインストールできます。

状態: experimental (`0.9.18`)。`1.0` まではプロトコルが変更される可能性があります。

MIT License。Mozilla または Thunderbird の公式プロジェクトではありません。
