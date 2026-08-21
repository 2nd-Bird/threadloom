# Threadloom

**Weave your AI conversations into your knowledge base.**

Threadloom is a small, local-first CLI that reads one ChatGPT conversation from
an already logged-in Chrome session via CDP and writes JSON, Markdown, or an
Obsidian folder. It only performs authenticated `GET` requests from
the attached ChatGPT tab; it never sends prompts, navigates, or changes your
conversation.

## Install and use

```sh
npm install -g github:2nd-Bird/threadloom
threadloom export 'https://chatgpt.com/c/<conversation-id>' --format markdown --out conversation.md
threadloom export <conversation-id> --format obsidian --out ~/Documents/Vault --folder ChatGPT-project
```

Chrome must already expose a remote debugging endpoint (default
`127.0.0.1:9222`) and have a logged-in ChatGPT tab. Use `--host` and `--port`
when yours differs.

## Privacy controls

Normal Obsidian exports are raw-first: they retain the backend response as
`RAW.json` alongside readable per-turn notes. `--omit-text` strips the
conversation title and every message/segment text before JSON, Markdown, and
Obsidian rendering, and switches Obsidian to metadata-only notes (no
`RAW.json`). It deliberately rejects `--format raw`, because a raw backend
response contains text.

`--folder` accepts only one directory-name component (`A-Z`, `a-z`, `0-9`,
`.`, `_`, `-`). Absolute paths, traversal and path separators are rejected;
every Obsidian write is checked to remain under the resolved `--out` root.
An existing non-empty target folder is rejected unless you explicitly pass
`--force`.

## Origin and license

Threadloom is derived from the MIT-licensed ChatGPT conversation-export feature
in [Oracle](https://github.com/steipete/oracle) by Peter Steinberger. See
[NOTICE](NOTICE) for attribution and [LICENSE](LICENSE) for license terms.
