import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import CDP from "chrome-remote-interface";

export type Format = "json" | "markdown" | "raw" | "obsidian";
export type Role = "user" | "assistant";
export interface ConversationRecord { ordinal: number; role: Role; turnId: string; messageIds: string[]; text?: string; markdown?: string; textHash: string; createTime?: string; model?: string; hiddenNodes: string[]; segments?: Array<{ messageId: string; contentType: string; text?: string; model?: string; createTime?: string }> }
export interface ExportValue { version: 1; source: { url: string; conversationId: string; targetId: string; exportedAt: string }; conversation: { title?: string; nodeCount: number; branchNodesSkipped: number; createTime?: string; updateTime?: string; defaultModelSlug?: string }; records: ConversationRecord[]; fingerprint: string; complete: true; raw?: unknown }

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const conversationId = (value: string) => value.match(/\/c\/([A-Za-z0-9-]+)(?=[/?#]|$)/)?.[1];
const iso = (seconds: unknown) => typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;

type Message = { id: string; author?: { role?: string }; create_time?: number; recipient?: string; content?: { content_type?: string; parts?: unknown[]; text?: string }; metadata?: { model_slug?: string; is_visually_hidden_from_conversation?: boolean } };
type Node = { id: string; parent?: string | null; message?: Message | null };
type Conversation = { title?: string; create_time?: number; update_time?: number; current_node?: string; mapping?: Record<string, Node>; default_model_slug?: string };

/** Build the only expression evaluated in the attached ChatGPT tab: authenticated reads. */
export function buildCdpReadExpression(id: string): string {
  return `(async()=>{const s=await fetch('/api/auth/session',{credentials:'include'});if(!s.ok)return {error:'session '+s.status};const j=await s.json();if(!j.accessToken)return {error:'no access token'};const r=await fetch('/backend-api/conversation/'+encodeURIComponent(${JSON.stringify(id)}),{credentials:'include',headers:{Authorization:'Bearer '+j.accessToken}});if(!r.ok)return {error:'conversation '+r.status};return {body:await r.json()}})()`;
}

function textParts(parts: unknown[] | undefined): string { return (parts ?? []).filter((x): x is string => typeof x === "string").join("\n\n"); }
function toRecords(body: Conversation): { records: ConversationRecord[]; branches: number } {
  const mapping = body.mapping ?? {}; const pathIds: string[] = []; let cursor = body.current_node;
  while (cursor && mapping[cursor]) { pathIds.push(cursor); cursor = mapping[cursor].parent ?? undefined; }
  pathIds.reverse(); const onPath = new Set(pathIds); const messages = pathIds.map(id => mapping[id].message).filter((m): m is Message => Boolean(m && m.author?.role !== "system"));
  const branchCount = Object.values(mapping).filter(n => n.message && !onPath.has(n.id)).length;
  const groups: Array<{role: Role; messages: Message[]}> = [];
  for (const m of messages) { const role: Role = m.author?.role === "user" ? "user" : "assistant"; const last = groups.at(-1); if (role === "assistant" && last?.role === role) last.messages.push(m); else groups.push({role, messages:[m]}); }
  return { branches: branchCount, records: groups.map((group, ordinal) => {
    const first = group.messages[0]; const segments = group.role === "assistant" ? group.messages.filter(m => (m.content?.content_type === "text" || m.content?.content_type === "multimodal_text") && !m.metadata?.is_visually_hidden_from_conversation).map(m => ({messageId:m.id, contentType:m.content?.content_type ?? "unknown", text:textParts(m.content?.parts), ...(m.metadata?.model_slug ? {model:m.metadata.model_slug}:{}), ...(iso(m.create_time) ? {createTime:iso(m.create_time)}:{})})) : undefined;
    const text = group.role === "user" ? textParts(first.content?.parts) : (segments ?? []).map(s => s.text).join("\n\n");
    const hiddenNodes = group.role === "assistant" ? group.messages.filter(m => !segments?.some(s => s.messageId === m.id)).map(m => `${m.author?.role ?? "unknown"}:${m.content?.content_type ?? "unknown"}`) : [];
    return {ordinal, role:group.role, turnId:first.id, messageIds:group.messages.map(m=>m.id), text, ...(group.role === "assistant" ? {markdown:text, segments}:{}), textHash:sha256(text), hiddenNodes, ...(iso(first.create_time) ? {createTime:iso(first.create_time)}:{}), ...(segments?.[0]?.model ? {model:segments[0].model}:{})};
  })};
}

export async function exportConversation(options: { ref?: string; host?: string; port?: number; includeRaw?: boolean }): Promise<ExportValue> {
  const host = options.host ?? "127.0.0.1"; const port = options.port ?? 9222;
  const targets = await CDP.List({host, port}) as Array<{id?: string; url?: string; type?: string}>;
  const idFromRef = options.ref && (conversationId(options.ref) ?? (/^[A-Za-z0-9-]+$/.test(options.ref) ? options.ref : undefined));
  const target = targets.find(t => t.type === "page" && t.url?.match(/^https:\/\/(chatgpt\.com|chat\.openai\.com)/) && (!idFromRef || conversationId(t.url ?? "") === idFromRef)) ?? targets.find(t => t.type === "page" && t.url?.match(/^https:\/\/(chatgpt\.com|chat\.openai\.com)/));
  if (!target?.id || !target.url) throw new Error("No matching logged-in ChatGPT tab found on the CDP endpoint.");
  const id = idFromRef ?? conversationId(target.url); if (!id) throw new Error("Provide a ChatGPT conversation URL or id; the attached tab is not on /c/<id>.");
  const client = await CDP({host, port, target:target.id});
  try { await client.Runtime.enable(); const expression = buildCdpReadExpression(id);
    const result = await client.Runtime.evaluate({expression, awaitPromise:true, returnByValue:true}); const value = result.result.value as {body?: Conversation; error?: string}; if (!value?.body) throw new Error(`ChatGPT conversation API read failed: ${value?.error ?? "no response"}.`);
    const built = toRecords(value.body); const provenance = built.records.map(({text, markdown, segments, ...r}) => ({...r, segments:segments?.map(({text,...s})=>s)}));
    return {version:1, source:{url:target.url,conversationId:id,targetId:target.id,exportedAt:new Date().toISOString()}, conversation:{...(value.body.title ? {title:value.body.title}:{}), nodeCount:Object.keys(value.body.mapping ?? {}).length, branchNodesSkipped:built.branches, ...(iso(value.body.create_time)?{createTime:iso(value.body.create_time)}:{}), ...(iso(value.body.update_time)?{updateTime:iso(value.body.update_time)}:{}), ...(value.body.default_model_slug?{defaultModelSlug:value.body.default_model_slug}:{})}, records:built.records, fingerprint:sha256(JSON.stringify(provenance)), complete:true, ...(options.includeRaw?{raw:value.body}:{})};
  } finally { await client.close(); }
}

/** Removes every human-readable conversation field before any formatter sees it. */
export function redact(value: ExportValue): ExportValue {
  return {
    ...value,
    raw: undefined,
    conversation: { ...value.conversation, title: undefined },
    records: value.records.map((record) => ({
      ...record,
      text: undefined,
      markdown: undefined,
      segments: record.segments?.map(({ text: _text, ...segment }) => segment),
    })),
  };
}
export function render(value: ExportValue, format: Exclude<Format,"obsidian">): string { if(format === "raw") return JSON.stringify(value.raw,null,2)+"\n"; if(format === "json") return JSON.stringify(value,null,2)+"\n"; return [`# ChatGPT conversation export`, ``, `Conversation: ${value.source.conversationId}`, `Complete: yes`, ``, ...value.records.map(r=>`## ${r.ordinal+1}. ${r.role}\n\n${r.text ?? "[redacted]"}`)].join("\n")+"\n"; }
export function safeFolder(name: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === "." || name === "..") throw new Error("--folder must be a single safe directory name (letters, numbers, ., _, - only)."); return name; }
export function defaultFolder(value: Pick<ExportValue, "source">): string { return `ChatGPT-${value.source.conversationId.slice(0, 8)}`; }
export function inside(base: string, candidate: string): string { const root=path.resolve(base); const resolved=path.resolve(root,candidate); if (resolved !== root && !resolved.startsWith(root+path.sep)) throw new Error("Output path escapes --out."); return resolved; }
export function validateFormat(format: Format, omitText: boolean): void { if (omitText && format === "raw") throw new Error("--omit-text cannot be used with --format raw because raw contains conversation text."); }
export async function writeObsidian(value: ExportValue, out: string, folder: string, omitText = false, force = false): Promise<void> {
  const dir = inside(out, safeFolder(folder));
  try {
    const existing = await fs.readdir(dir);
    if (existing.length > 0 && !force) throw new Error(`Obsidian folder already exists and is not empty: ${folder}. Use --force to overwrite it.`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const exported = omitText ? redact(value) : value;
  await fs.mkdir(dir, { recursive: true });
  const title = exported.conversation.title ?? "ChatGPT conversation";
  const index = ["---", "source: chatgpt", `redaction: ${omitText ? "text" : "none"}`, `conversation_id: ${exported.source.conversationId}`, "---", "", `# ${omitText ? "ChatGPT conversation (redacted)" : title}`, "", ...exported.records.map(r => `- [[${String(r.ordinal + 1).padStart(3, "0")}-${r.role}]]`)].join("\n") + "\n";
  await fs.writeFile(inside(out, path.join(folder, "INDEX.md")), index, "utf8");
  if (!omitText && value.raw !== undefined) await fs.writeFile(inside(out, path.join(folder, "RAW.json")), JSON.stringify(value.raw, null, 2) + "\n", "utf8");
  for (const r of exported.records) {
    const file = `${String(r.ordinal + 1).padStart(3, "0")}-${r.role}.md`;
    const content = omitText ? "[redacted]" : (r.markdown ?? r.text ?? "");
    const body = `---\nsource: chatgpt\nredaction: ${omitText ? "text" : "none"}\nturn_id: ${r.turnId}\nrole: ${r.role}\nsha256: ${r.textHash}\n---\n\n# ${r.role}${omitText ? " (redacted)" : ""}\n\n${content}\n`;
    await fs.writeFile(inside(out, path.join(folder, file)), body, "utf8");
  }
}
