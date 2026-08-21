import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cdp = vi.hoisted(() => {
  const client = { Runtime: { enable: vi.fn(), evaluate: vi.fn() }, close: vi.fn() };
  return { client, connect: vi.fn(async () => client), list: vi.fn() };
});
vi.mock("chrome-remote-interface", () => ({ default: Object.assign(cdp.connect, { List: cdp.list }) }));
import { buildCdpReadExpression, defaultFolder, exportConversation, redact, render, safeFolder, validateFormat, writeObsidian, type ExportValue } from "../src/export.js";

const fixture: ExportValue = { version:1, source:{url:"https://chatgpt.com/c/abc",conversationId:"abc",targetId:"target",exportedAt:"2026-01-01T00:00:00.000Z"}, conversation:{title:"secret title",nodeCount:2,branchNodesSkipped:0}, records:[{ordinal:0,role:"user",turnId:"one",messageIds:["one"],text:"secret prompt",textHash:"hash",hiddenNodes:[]},{ordinal:1,role:"assistant",turnId:"two",messageIds:["two"],text:"secret reply",markdown:"secret reply",textHash:"hash2",hiddenNodes:[],segments:[{messageId:"two",contentType:"text",text:"secret reply"}]}],fingerprint:"fingerprint",complete:true,raw:{title:"secret title"} };

describe("privacy",()=>{
  it("removes text and title before json and markdown rendering",()=>{ const value=redact(fixture); const json=render(value,"json"); const markdown=render(value,"markdown"); for(const output of [json,markdown]) { expect(output).not.toContain("secret"); } expect(json).not.toContain("title"); });
  it("writes normal Obsidian raw-first, but omit text is metadata-only",async()=>{ const out=await fs.mkdtemp(path.join(os.tmpdir(),"threadloom-")); await writeObsidian(fixture,out,"normal"); const raw=await fs.readFile(path.join(out,"normal","RAW.json"),"utf8"); expect(raw).toContain("secret title"); await writeObsidian(fixture,out,"redacted",true); const files=await fs.readdir(path.join(out,"redacted")); const all=await Promise.all(files.map(f=>fs.readFile(path.join(out,"redacted",f),"utf8"))); expect(files).not.toContain("RAW.json"); expect(all.join("\n")).not.toContain("secret"); });
  it("rejects omit text with raw before API export",()=>expect(()=>validateFormat("raw",true)).toThrow("--omit-text cannot be used with --format raw"));
});
describe("safe output paths",()=>{ it.each(["../escape","a/b","a\\b","/tmp/x","..",""])("rejects unsafe folder %s",name=>expect(()=>safeFolder(name)).toThrow()); it("writes only below out",async()=>{ const out=await fs.mkdtemp(path.join(os.tmpdir(),"threadloom-")); await writeObsidian(fixture,out,"inside"); await expect(fs.stat(path.join(out,"inside","INDEX.md"))).resolves.toBeDefined(); }); it("rejects an existing non-empty folder unless force is set",async()=>{ const out=await fs.mkdtemp(path.join(os.tmpdir(),"threadloom-")); const dir=path.join(out,"inside"); await fs.mkdir(dir); await fs.writeFile(path.join(dir,"keep.md"),"keep"); await expect(writeObsidian(fixture,out,"inside")).rejects.toThrow("not empty"); await expect(writeObsidian(fixture,out,"inside",false,true)).resolves.toBeUndefined(); }); });
describe("CDP reads",()=>{ it("builds authenticated read-only requests",()=>{ const expression=buildCdpReadExpression("abc-123"); expect(expression).toContain("/api/auth/session"); expect(expression).toContain("/backend-api/conversation/"); expect(expression).toContain("encodeURIComponent(\"abc-123\")"); expect(expression).not.toMatch(/method:\s*['\"]POST|\.click\(|\.submit\(|location\s*=|navigate/i); }); it("enables Runtime, evaluates the reader, then closes",async()=>{ cdp.list.mockResolvedValue([{id:"tab",type:"page",url:"https://chatgpt.com/c/abc"}]); cdp.client.Runtime.evaluate.mockResolvedValue({result:{value:{body:{title:"test",mapping:{}}}}}); await exportConversation({ref:"abc"}); expect(cdp.client.Runtime.enable).toHaveBeenCalledOnce(); expect(cdp.client.Runtime.evaluate).toHaveBeenCalledWith(expect.objectContaining({awaitPromise:true,returnByValue:true})); expect(cdp.client.close).toHaveBeenCalledOnce(); }); it("derives a folder from the exported conversation id",()=>expect(defaultFolder(fixture)).toBe("ChatGPT-abc")); });
