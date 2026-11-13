import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../src/contract";
import { conversationRig, said, settled, type Rig } from "./support/rig";
import { SLOW } from "./support/host";

let rig: Rig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** An uploaded file, as the UI sends it: begin, one chunk, finish. */
function upload(r: Rig, name: string, data: Buffer) {
    const files = r.conversation.attachments;
    const { id } = files.begin(name, data.length);
    files.put(id, 0, data.toString("base64"));
    return files.finish(id);
}

// Transcripts and history survive.
describe("the transcript", () => {
    test("survives a restart: the latest copy of an entry wins and a torn last line is dropped", async () => {
        rig = await conversationRig();
        rig.conversation.send("one");
        await settled(rig);
        rig.conversation.send("two");
        await settled(rig);
        const before = rig.conversation.history();
        expect(before.map((e) => e.kind)).toEqual(["user", "agent", "user", "agent"]);
        const file = path.join(rig.dir, "transcript.jsonl");
        // an entry written again later (a card that changed), then a crash mid-append
        const changed = { ...before[1]!, text: "changed later" };
        fs.appendFileSync(file, JSON.stringify(changed) + "\n" + '{"id":"torn","at":1,"kind":"us');
        await rig.conversation.shutdown();
        rig.restart();
        const after = rig.conversation.history();
        // one copy of each, the changed one as it was last written; the torn line isn't an entry
        const byId = (list: typeof after) => Object.fromEntries(list.map((e) => [e.id, e]));
        expect(byId(after)).toEqual(byId([before[0]!, changed, before[2]!, before[3]!]));
        expect(after).toHaveLength(4);
    }, SLOW);

    test("compacting drops superseded copies and never a message, and doesn't rewrite on every append", async () => {
        rig = await conversationRig();
        const file = path.join(rig.dir, "transcript.jsonl");
        // 600 messages of 8 KB is past the 4 MB cap and past the 500 kept in memory
        const old = Array.from({ length: 600 }, (_, i) => ({ id: `m${String(i).padStart(4, "0")}`, at: 1000 + i, kind: "agent", text: `${i} ${"x".repeat(8 * 1024)}` }));
        const superseded = { ...old[0]!, text: "first, before it changed" };
        fs.writeFileSync(file, [superseded, ...old].map((e) => JSON.stringify(e)).join("\n") + "\n");
        await rig.conversation.shutdown();
        rig.restart();
        // memory still holds only the latest messages, as it always did
        expect(rig.conversation.history()).toHaveLength(LIMITS.history);

        rig.conversation.send("one more");
        await settled(rig);
        const ids = () => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id as string);
        // the superseded copy is gone, every one of the 600 older messages is still on disk
        expect(ids().filter((id) => old.some((o) => o.id === id))).toEqual(old.map((o) => o.id));
        expect(ids().length).toBe(new Set(ids()).size);

        // still over the cap with nothing left to drop: later messages append, they don't rewrite the file
        const size = fs.statSync(file).size;
        const before = ids();
        rig.conversation.send("and another");
        await settled(rig);
        expect(ids().slice(0, before.length)).toEqual(before);
        expect(fs.statSync(file).size).toBeGreaterThan(size);
        expect(rig.conversation.history()).toHaveLength(LIMITS.history);
    }, SLOW);

    test("damage before the last line is refused, never read as an empty conversation", async () => {
        rig = await conversationRig();
        rig.conversation.send("keep me");
        await settled(rig);
        const file = path.join(rig.dir, "transcript.jsonl");
        const lines = fs.readFileSync(file, "utf8").split("\n");
        fs.writeFileSync(file, [lines[0], "{broken", ...lines.slice(1)].join("\n"));
        const saved = fs.readFileSync(file, "utf8");
        await rig.conversation.shutdown();
        expect(() => rig!.restart()).toThrow(/line 2 is unreadable/);
        // left as it was, for the user to see
        expect(fs.readFileSync(file, "utf8")).toBe(saved);
        // a working conversation for close()
        fs.writeFileSync(file, "");
        rig.restart();
    }, SLOW);
});

// Transcripts and history survive.
describe("the history", () => {
    test("a conversation keeps one id across put-away, reopen and restart, and resumes its harness thread", async () => {
        rig = await conversationRig();
        rig.conversation.send("first conversation");
        await settled(rig);
        const id = rig.conversation.id();
        const thread = rig.turns()[0].thread;
        await rig.conversation.newConversation();
        expect(rig.conversation.history()).toEqual([]);
        expect(rig.conversation.id()).not.toBe(id);
        expect(rig.conversation.past().map((p) => [p.id, p.title])).toEqual([[id, "first conversation"]]);

        await rig.conversation.shutdown();
        rig.restart();
        expect(rig.conversation.past().map((p) => p.id)).toEqual([id]);
        await rig.conversation.open(id);
        expect(rig.conversation.id()).toBe(id);
        expect(said(rig)).toHaveLength(1);

        await rig.conversation.shutdown();
        rig.restart();
        expect(rig.conversation.id()).toBe(id);
        rig.conversation.send("back again");
        await settled(rig);
        const last = rig.turns().at(-1);
        expect(last.thread).toBe(thread);
        expect(rig.host.started.at(-1)!.args.filter((a) => a === "exec" || a === "resume")).toEqual(["exec", "resume"]);
    }, SLOW);

    test("a full history refuses a new conversation rather than drop an old one", async () => {
        rig = await conversationRig();
        const past = path.join(rig.dir, "past");
        for (let i = 0; i < LIMITS.pastConversations; i++) {
            const id = i.toString(16).padStart(12, "0");
            fs.mkdirSync(path.join(past, id), { recursive: true });
            fs.writeFileSync(path.join(past, id, "meta.json"), JSON.stringify({ id, title: `old ${i}`, startedAt: i, endedAt: i, messages: 1 }));
        }
        rig.conversation.send("the current one");
        await settled(rig);
        await expect(rig.conversation.newConversation()).rejects.toThrow(/delete some from the history first/);
        expect(rig.conversation.history().map((e) => e.kind)).toEqual(["user", "agent"]);
        expect(rig.conversation.past()).toHaveLength(LIMITS.pastConversations);
    }, SLOW);

    test("an unreadable meta.json is an error that names it", async () => {
        rig = await conversationRig();
        const dir = path.join(rig.dir, "past", "0123456789ab");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "meta.json"), "{nope");
        expect(() => rig!.conversation.past()).toThrow(new RegExp(`${path.join(dir, "meta.json").replace(/[\\.]/g, "\\$&")} can't be read`));
    });

    test("attachments follow their conversation into the history and back", async () => {
        rig = await conversationRig();
        const file = upload(rig, "photo.png", PNG);
        rig.conversation.send("look", null, [file.id]);
        await settled(rig);
        const id = rig.conversation.id();
        await rig.conversation.newConversation();
        expect(() => rig!.conversation.attachments.get(file.id)).toThrow(/no file/);
        expect(fs.readFileSync(path.join(rig.dir, "past", id, "attachments", file.id))).toEqual(PNG);
        await rig.conversation.open(id);
        expect(rig.conversation.attachments.bytes(file.id)).toEqual(PNG);
        expect(rig.conversation.history()[0]).toMatchObject({ kind: "user", attachments: [{ id: file.id, name: "photo.png", type: "image/png" }] });
    }, SLOW);

    test("conversation and attachment ids that aren't ids are refused", async () => {
        rig = await conversationRig();
        const outside = path.join(rig.root, "escape");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "meta.json"), "{}");
        await expect(rig.conversation.open("../escape")).rejects.toThrow("that isn't a conversation's id");
        expect(() => rig!.conversation.deletePast("../escape")).toThrow("that isn't a conversation's id");
        expect(fs.existsSync(outside)).toBe(true);
        for (const id of ["../escape", "../../etc/passwd", "ABCDEF123456"]) {
            expect(() => rig!.conversation.attachments.get(id)).toThrow("that isn't a file's id");
            expect(() => rig!.conversation.attachments.read(id, 0)).toThrow("that isn't a file's id");
        }
        expect(() => rig!.conversation.send("hi", null, ["../escape"])).toThrow("that isn't a file's id");
    });
});
