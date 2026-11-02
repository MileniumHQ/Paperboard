// A server's console and chat survive a service restart: written to a real
// file, read back by the next service, damage said instead of dropped.
import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HISTORY_CHAT, HISTORY_ENTRIES, historyWriter, readHistory } from "../src/service/history";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-history-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const chat = (n: number) => ({ id: `chat-${n}`, text: `<Steve> ${n}`, timestamp: "12:00:00", sender: "Steve", content: String(n) });

describe("console history", () => {
    it("what a server said is read back by the next service, capped", async () => {
        const file = path.join(root, "a", "history", "s-1.json");
        const errors: unknown[] = [];
        const writer = historyWriter(async () => file, (err) => errors.push(err), 10);
        const serverEntries = Array.from({ length: HISTORY_ENTRIES + 20 }, (_, i) => ({ type: "output" as const, content: `line ${i}` }));
        const chatMessages = Array.from({ length: HISTORY_CHAT + 5 }, (_, i) => chat(i));
        writer.changed({ serverEntries, chatMessages, serverStatus: "online" });
        await Bun.sleep(40);
        await writer.flush();
        expect(errors).toEqual([]);
        const back = await readHistory(file);
        expect(back.serverEntries.length).toBe(HISTORY_ENTRIES);
        expect(back.serverEntries.at(-1)!.content).toBe(`line ${HISTORY_ENTRIES + 19}`);
        expect(back.chatMessages.length).toBe(HISTORY_CHAT);
        expect(back.chatMessages.at(-1)).toEqual(chat(HISTORY_CHAT + 4));
        // a running server is remembered as one, so a start can pick it back up
        expect(back.running).toBe(true);
        writer.changed({ serverEntries, chatMessages, serverStatus: "stopping" });
        await Bun.sleep(40);
        await writer.flush();
        expect((await readHistory(file)).running).toBe(false);
    });

    it("a server that never said anything opens empty", async () => {
        expect(await readHistory(path.join(root, "missing.json"))).toEqual({ serverEntries: [], chatMessages: [], running: false });
    });

    it("a damaged file is an error, not an empty console", async () => {
        const file = path.join(root, "damaged.json");
        fs.writeFileSync(file, "{\"version\":1,\"serverEntries\":");
        await expect(readHistory(file)).rejects.toThrow();
        fs.writeFileSync(file, JSON.stringify({ version: 1, serverEntries: "no" }));
        await expect(readHistory(file)).rejects.toThrow("damaged");
    });

    it("a write that fails is reported once, and nothing is written after stop", async () => {
        const blocker = path.join(root, "blocker");
        fs.writeFileSync(blocker, "a file where the history folder should be");
        const errors: unknown[] = [];
        const writer = historyWriter(async () => path.join(blocker, "s-2.json"), (err) => errors.push(err), 5);
        writer.changed({ serverEntries: [{ type: "info", content: "one" }], chatMessages: [], serverStatus: "offline" });
        await writer.flush();
        writer.changed({ serverEntries: [{ type: "info", content: "two" }], chatMessages: [], serverStatus: "offline" });
        await writer.flush();
        expect(errors.length).toBe(1);

        const file = path.join(root, "stopped", "s-3.json");
        const stopped = historyWriter(async () => file, () => {}, 5);
        stopped.changed({ serverEntries: [{ type: "info", content: "late" }], chatMessages: [], serverStatus: "offline" });
        await stopped.stop();
        await Bun.sleep(20);
        expect(fs.existsSync(file)).toBe(false);
    });
});
