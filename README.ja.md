# Threadloom

**Weave your AI conversations into your knowledge base.**

Threadloom は、Chrome にログイン済みの ChatGPT 会話を CDP 経由でローカルへ取り出す小さな CLI です。JSON、Markdown、または Obsidian 出力に対応します。会話の送信・移動・変更は行わず、接続済みタブから認証済み `GET` のみを実行します。

```sh
npm install -g github:2nd-Bird/threadloom
threadloom export <conversation-id> --format markdown --out conversation.md
threadloom export <conversation-id> --format obsidian --out ~/Vault --folder ChatGPT-project
```

通常の Obsidian 出力は raw-first で、バックエンド応答を `RAW.json` として保存し、ターン別ノートも作成します。`--omit-text` は title を含む全会話テキストを除去し、`RAW.json` を作らない metadata-only 出力に切り替えます。raw は本文を含むため併用不可です。`--folder` は安全な単一フォルダ名だけを受け付け、すべての書き込みを `--out` 配下に制限します。既存の非空フォルダへは `--force` なしで書き込めません。

Oracle（Peter Steinberger）の MIT ライセンス会話エクスポート機能を基にしています。詳細は [NOTICE](NOTICE) を参照してください。
