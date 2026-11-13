// One conversation over a real fake brain: the panel's Conversation, the
// computer's MCP endpoint and a TestHost, in a temp folder of its own.

import fs from "node:fs";
import path from "node:path";
import type { ChatEntry, ChatState, Harness, Settings } from "../../src/contract";
import type { Sections } from "../../src/service/toolsets";
import { startComputerMcp, type ComputerMcp } from "../../src/service/computerMcp";
import { Conversation, TURN_PROC_ID } from "../../src/service/conversation";
import { messagesToolset } from "../../src/service/messages";
import { toolbox } from "../../src/service/toolsets";
import { brainProgram, fakeEnv, fakeLog, Recorder, TestHost, tempDir } from "./host";

export interface Rig {
    root: string;
    dir: string;
    host: TestHost;
    conversation: Conversation;
    entries: Recorder<ChatEntry>;
    states: Recorder<ChatState>;
    mcp: ComputerMcp;
    settings: Settings;
    /** the fake brain's log */
    log(): any[];
    /** the turns the brain was started for */
    turns(): any[];
    /** a fresh Conversation over the same folder: the service started again */
    restart(): Conversation;
    close(): Promise<void>;
}

export async function conversationRig(o: { harness?: Harness; contextBudget?: number; problem?: (h: Harness) => string | null; resolve?: (h: Harness) => string | null; env?: (h: Harness) => Record<string, string>; root?: string; instructions?: () => Promise<Sections> } = {}): Promise<Rig> {
    const root = o.root ?? tempDir("conversation");
    const harness = o.harness ?? "codex";
    const host = new TestHost(fakeEnv(root));
    const program = brainProgram(root, harness);
    const dir = path.join(root, "storage", "conversation");
    const codexHome = path.join(root, "storage", "brains", "codex");
    fs.mkdirSync(codexHome, { recursive: true });
    // the real messages toolset, texting the rig's conversation
    const mcp = await startComputerMcp(toolbox([messagesToolset({ say: (text, replyTo, files) => rig.conversation.say(text, replyTo, files) })]));
    const settings: Settings = { name: "Ada", harness, model: null, compaction: "summarize" };
    const entries = new Recorder<ChatEntry>();
    const states = new Recorder<ChatState>();
    const make = () => {
        const c = new Conversation({
            host,
            dir,
            settings: () => rig.settings,
            resolve: o.resolve ?? (() => program),
            env: o.env ?? ((h): Record<string, string> => (h === "codex" ? { CODEX_HOME: codexHome } : {})),
            problem: o.problem,
            mcp: () => ({ url: mcp.url, token: mcp.token, onToolsListed: (cb) => mcp.onToolsListed(cb) }),
            instructions: o.instructions ?? (async () => ({ tools: ["**Test:** a section"], now: [] })),
            emit: entries.push,
            onState: states.push,
            codexHome,
            contextBudget: o.contextBudget,
        });
        c.init();
        return c;
    };
    const rig: Rig = {
        root,
        dir,
        host,
        conversation: null as unknown as Conversation,
        entries,
        states,
        mcp,
        settings,
        log: () => fakeLog(root),
        turns: () => fakeLog(root).filter((e) => e.event === "turn"),
        restart: () => (rig.conversation = make()),
        close: async () => {
            await rig.conversation.shutdown();
            await host.close();
            await mcp.close();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
    rig.conversation = make();
    return rig;
}

/** Resolves once no turn is running and the conversation has caught up. */
export function settled(rig: Rig, what = "the turn to end") {
    return rig.states.until((s) => {
        const last = s.at(-1);
        return !!last && !last.compacting && last.waiting.length === 0 && (rig.conversation as unknown as { running: unknown }).running === null;
    }, what);
}

export const turnId = TURN_PROC_ID;

export const said = (rig: Rig) => rig.conversation.history().filter((e) => e.kind === "agent").map((e) => (e as { text: string }).text);
export const errors = (rig: Rig) => rig.conversation.history().filter((e) => e.kind === "error");
