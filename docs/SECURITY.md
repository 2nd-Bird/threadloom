# Security model

Threadloom attaches only to a user-provided Chrome DevTools endpoint and uses
the logged-in ChatGPT page to issue `GET /api/auth/session` and
`GET /backend-api/conversation/<id>`. Tokens are never printed or written.

Text-redaction is applied before JSON/Markdown/Obsidian rendering when
`--omit-text` is selected. Raw is rejected with `--omit-text`.
Folder names and every derived file path are validated against the resolved
output root to prevent traversal.
