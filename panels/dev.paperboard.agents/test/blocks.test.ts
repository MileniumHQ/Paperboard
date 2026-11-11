import { afterEach, describe, expect, test } from "bun:test";
import { TURN_PROC_ID } from "../src/service/conversation";
import { appRig, type AppRig } from "./support/app";
import { SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const replies = (r: AppRig) => r.blocks.fired.items.filter((f) => f.event === "message-received");

// The agent's blocks (Actions API v2), as the Blocks panel runs them.
describe("the agent's blocks", () => {
    test("registers the agent's types, values, commands and events, and none of the panel's own actions", async () => {
        rig = await appRig();
        const set = rig.blocks.set!;
        expect(set.types!.map((t) => t.id)).toEqual(["conversation", "message", "fact", "note", "routine", "attachment"]);
        expect(Object.keys(set.types![0]!.fields!)).toEqual(["title", "messages"]);
        expect(Object.keys(set.types![1]!.fields!)).toEqual(["text", "from"]);
        expect(set.values!.map((v) => [v.id, v.type, v.changes ?? false])).toEqual([
            ["current-conversation", "conversation", true],
            ["conversations", "list<conversation>", true],
            ["messages", "list<message>", false],
            ["facts", "list<fact>", true],
            ["notes", "list<note>", true],
            ["routines", "list<routine>", true],
            ["computer-running", "boolean", true],
        ]);
        expect(set.commands!.map((c) => [c.id, c.output])).toEqual([
            ["switch-conversation", "conversation"],
            ["new-conversation", "conversation"],
            ["clear-conversation", undefined],
            ["delete-conversation", undefined],
            ["send-message", "message"],
            ["get-answer", "text"],
            ["add-fact", "fact"],
            ["edit-fact", "fact"],
            ["forget-fact", undefined],
            ["save-note", "note"],
            ["delete-note", undefined],
            ["add-routine-once", "routine"],
            ["add-routine-daily", "routine"],
            ["add-routine-repeating", "routine"],
            ["cancel-routine", undefined],
            ["start-computer", undefined],
            ["stop-computer", undefined],
        ]);
        expect(set.events!.map((e) => [e.id, e.filters])).toEqual([
            ["message-received", { conversation: "conversation" }],
            ["turn-failed", { conversation: "conversation" }],
            ["routine-fired", { routine: "routine" }],
        ]);
        // no secrets, sign-ins, provider keys or the computer's screen and input
        const ids = [...set.commands!, ...set.values!].map((d) => d.id).join(" ");
        expect(ids).not.toMatch(/secret|key|sign-in|provider|frame|input|control/);
    });

    test("a text to the agent is a Message, its reply fires When the Agent Replies, and the conversations announce the change", async () => {
        rig = await appRig();
        const current = await rig.blocks.read<string>("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("New conversation");

        const message = await rig.blocks.run<string>("send-message", { message: "what's up?" });
        await rig.blocks.fired.until((f) => f.length > 0, "the agent's reply");
        const entry = rig.app.conversation.history().find((e) => e.kind === "agent")!;
        expect(replies(rig)[0]!.payload).toEqual({
            text: entry.kind === "agent" ? entry.text : "",
            attachments: [],
            message: entry.id,
            conversation: current,
            "reply-to": null,
        });
        expect(rig.app.conversation.history()[0]).toMatchObject({ id: message, kind: "user", text: "what's up?" });

        await rig.blocks.changes.until((c) => c.includes("conversations"), "the conversations to announce the change");
        expect(rig.blocks.changes.items).not.toContain("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([current]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("what's up?");
        expect(await rig.blocks.property("conversation", "messages", current)).toBe(2);
    }, SLOW);

    test("New Conversation and Switch Conversation give back the Conversation, and an unknown one is refused", async () => {
        rig = await appRig();
        await rig.blocks.run("send-message", { message: "first" });
        await rig.blocks.fired.until((f) => f.length === 1, "the first reply");
        const first = await rig.blocks.read<string>("current-conversation");

        const second = await rig.blocks.run<string>("new-conversation");
        expect(second).not.toBe(first);
        expect(await rig.blocks.read("current-conversation")).toBe(second);
        await rig.blocks.changes.until((c) => c.includes("current-conversation"), "the current conversation to announce the change");
        expect(await rig.blocks.property("conversation", "title", first)).toBe("first");

        expect(await rig.blocks.run("switch-conversation", { conversation: first })).toBe(first);
        expect(rig.app.conversation.id()).toBe(first);
        await expect(rig.blocks.run("switch-conversation", {})).rejects.toThrow('"Conversation" is required');
        await expect(rig.blocks.property("conversation", "title", "nope")).rejects.toThrow('the agent has no conversation "nope"');
    }, SLOW);

    test("Ask the Agent gives back the answer, never touching the conversation", async () => {
        rig = await appRig();
        expect(await rig.blocks.run("get-answer", { question: "capital of France?" })).toBe("ok: capital of France?");
        expect(rig.app.conversation.history()).toEqual([]);
        expect(rig.host.startedAs(TURN_PROC_ID)).toEqual([]);
        await expect(rig.blocks.run("get-answer", { question: "" })).rejects.toThrow('"Question" is required');
    }, SLOW);

    test("Messages lists a conversation's texts with who sent them, in the history too; Delete and Clear Conversation are for good", async () => {
        rig = await appRig();
        const first = await rig.blocks.read<string>("current-conversation");
        const sent = await rig.blocks.run<string>("send-message", { message: "hello" });
        await rig.blocks.fired.until((f) => replies(rig!).length === 1, "the reply");
        const said = await rig.blocks.read<string[]>("messages", { conversation: first });
        expect(said[0]).toBe(sent);
        expect(said).toHaveLength(2);
        expect(await rig.blocks.property("message", "text", sent)).toBe("hello");
        expect(await rig.blocks.property("message", "from", sent)).toBe("user");
        expect(await rig.blocks.property("message", "from", said[1])).toBe("agent");

        // put away in the history, its texts still read
        const second = await rig.blocks.run<string>("new-conversation");
        expect(await rig.blocks.read("messages", { conversation: first })).toEqual(said);
        expect(await rig.blocks.property("message", "text", sent)).toBe("hello");
        await expect(rig.blocks.run("delete-conversation", { conversation: second })).rejects.toThrow("The current conversation can't be deleted");
        await rig.blocks.run("delete-conversation", { conversation: first });
        expect(await rig.blocks.read("conversations")).toEqual([]);
        await expect(rig.blocks.read("messages", { conversation: first })).rejects.toThrow(`the agent has no conversation "${first}"`);
        await expect(rig.blocks.property("message", "text", sent)).rejects.toThrow(`the agent has no message "${sent}"`);

        await rig.blocks.run("send-message", { message: "again" });
        await rig.blocks.fired.until(() => replies(rig!).length === 2, "the second reply");
        expect(await rig.blocks.read("messages", { conversation: second })).toHaveLength(2);
        const changes = rig.blocks.changes.items.length;
        await rig.blocks.run("clear-conversation");
        expect(await rig.blocks.read("messages", { conversation: second })).toEqual([]);
        expect(await rig.blocks.read("conversations")).toEqual([]);
        expect(rig.blocks.changes.items.slice(changes)).toContain("conversations");
    }, SLOW);

    test("When the Agent's Turn Fails fires with the error, in the conversation it failed in", async () => {
        rig = await appRig();
        const current = await rig.blocks.read<string>("current-conversation");
        await rig.blocks.run("send-message", { message: "[[silent]]" });
        await rig.blocks.fired.until((f) => f.some((x) => x.event === "turn-failed"), "the turn to fail");
        expect(rig.blocks.fired.items.find((f) => f.event === "turn-failed")!.payload).toEqual({ error: "the turn ended without a reply", conversation: current });
    }, SLOW);

    test("facts and notes are added, read, changed and forgotten, and their lists announce the change", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("facts")).toEqual([]);
        const fact = await rig.blocks.run<string>("add-fact", { text: "likes tea" });
        expect(await rig.blocks.read("facts")).toEqual([fact]);
        expect(await rig.blocks.property("fact", "text", fact)).toBe("likes tea");
        await rig.blocks.changes.until((c) => c.includes("facts"), "Facts to announce the change");
        expect(await rig.app.memory.instructions()).toContain("likes tea");

        expect(await rig.blocks.run("edit-fact", { fact, text: "likes coffee" })).toBe(fact);
        expect(await rig.blocks.property("fact", "text", fact)).toBe("likes coffee");
        await expect(rig.blocks.run("add-fact", { text: "two\nlines" })).rejects.toThrow("a fact is one line");

        const note = await rig.blocks.run<string>("save-note", { key: "garden", when: "asked about plants", body: "# Tomatoes\nwater daily" });
        expect(note).toBe("garden");
        expect(await rig.blocks.read("notes")).toEqual(["garden"]);
        expect(await rig.blocks.property("note", "when", note)).toBe("asked about plants");
        expect(await rig.blocks.property("note", "body", note)).toBe("# Tomatoes\nwater daily");
        await rig.blocks.changes.until((c) => c.includes("notes"), "Notes to announce the change");
        await expect(rig.blocks.run("save-note", { key: "Not A Key", when: "never", body: "x" })).rejects.toThrow("a note's key is lowercase letters");

        await rig.blocks.run("forget-fact", { fact });
        await rig.blocks.run("delete-note", { note });
        expect(await rig.blocks.read("facts")).toEqual([]);
        expect(await rig.blocks.read("notes")).toEqual([]);
        await expect(rig.blocks.property("fact", "text", fact)).rejects.toThrow(`the agent has no fact "${fact}"`);
        await expect(rig.blocks.run("forget-fact", { fact })).rejects.toThrow(`no fact ${fact}`);
        await rig.blocks.changes.until((c) => c.filter((v) => v === "facts").length >= 2 && c.filter((v) => v === "notes").length >= 2, "both lists to announce the removal");
    }, SLOW);

    test("routines are added on each kind of schedule, read, cancelled and announced, and one that's due fires When a Routine Fires", async () => {
        rig = await appRig();
        const daily = await rig.blocks.run<string>("add-routine-daily", { task: "check the forum", days: "weekdays", time: "09:00" });
        expect(await rig.blocks.property("routine", "schedule", daily)).toBe("weekdays at 09:00");
        expect(await rig.blocks.property("routine", "task", daily)).toBe("check the forum");
        expect(await rig.blocks.property("routine", "last-run", daily)).toBe(null);
        const repeating = await rig.blocks.run<string>("add-routine-repeating", { task: "water the plants", minutes: 120 });
        expect(await rig.blocks.property("routine", "schedule", repeating)).toBe("every 2 hours");
        const at = new Date(Date.now() + 2 * 24 * 60 * 60_000).setSeconds(0, 0);
        const once = await rig.blocks.run<string>("add-routine-once", { task: "say happy birthday", at });
        expect(await rig.blocks.property("routine", "next", once)).toBe(at);
        expect((await rig.blocks.read<string[]>("routines")).sort()).toEqual([daily, repeating, once].sort());
        await rig.blocks.changes.until((c) => c.includes("routines"), "Routines to announce the change");

        await expect(rig.blocks.run("add-routine-once", { task: "too late", at: Date.now() - 60 * 60_000 })).rejects.toThrow("has already passed");
        await expect(rig.blocks.run("add-routine-daily", { task: "x", days: "weekdays", time: "9am" })).rejects.toThrow("time is HH:MM");
        await expect(rig.blocks.run("add-routine-repeating", { task: "x", minutes: 5 })).rejects.toThrow('"Minutes" must be at least 15');

        await rig.blocks.run("cancel-routine", { routine: daily });
        expect(await rig.blocks.read<string[]>("routines")).not.toContain(daily);
        await expect(rig.blocks.property("routine", "task", daily)).rejects.toThrow(`the agent has no routine "${daily}"`);

        // its time comes: the timer's run, on the routines' own clock
        (rig.app.routines as unknown as { next: Map<string, number> }).next.set(repeating, Date.now() - 1000);
        await rig.app.routines.check();
        expect(rig.blocks.fired.items.find((f) => f.event === "routine-fired")!.payload).toEqual({ routine: repeating, task: "water the plants", late: false });
        expect(await rig.blocks.property("routine", "last-run", repeating)).toBeNumber();
    }, SLOW);

    test("Computer Running reads the computer, and starting one that isn't set up fails with why", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("computer-running")).toBe(false);
        await expect(rig.blocks.run("start-computer")).rejects.toThrow("Set up the computer first.");
        await rig.blocks.run("stop-computer");
        expect(await rig.blocks.read("computer-running")).toBe(false);
    }, SLOW);
});
