import os from "node:os";
import path from "node:path";
import { actionsApi, configApi, defineAction, definePanelService, fileApi, processApi, secretsApi, type ActionDefinition } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, PANEL_ID, UI_ACTION_IDS, type AiState } from "./contract";
import { TOOLS_ACTION_IDS } from "./toolsContract";
import { AiApp, which, type AppHost } from "./service/app";

// the tool servers and the actions switch: another document, so one never overwrites the other
const TOOLS_PATH = "tools.json";

const host: AppHost = {
    start: (o) => processApi.start(o),
    kill: (id, signal) => processApi.kill(id, signal),
    exists: (id) => processApi.exists(id),
    onExit: (id, cb) => processApi.onExit(id, cb),
    // a harness's stdout is its protocol: stderr never mixes into it
    onStdout: (id, cb) => processApi.onStdout(id, cb),
    onStderr: (id, cb) => processApi.onStderr(id, cb),
    exec: (command, args, o) => processApi.exec(command, args, { timeoutMs: o?.timeoutMs }),
    download: (o) =>
        fileApi.download({
            url: o.url,
            targetPath: o.targetPath,
            appId: PANEL_ID,
            sha256: o.sha256,
            onProgress: (p) => o.onProgress?.(p.percent),
        }),
    storageDir: () => fileApi.getPath("", PANEL_ID),
    readSettings: () => configApi.get(PANEL_ID),
    writeSettings: (s) => configApi.set(s, PANEL_ID),
    which,
    tools: {
        write: (id, data) => processApi.write(id, data),
        readTools: () => configApi.get(PANEL_ID, TOOLS_PATH),
        writeTools: (c) => configApi.set(c, PANEL_ID, TOOLS_PATH),
        // this panel's vault entries only, the panel id explicit on every call
        vault: {
            get: async (name) => {
                const r = await secretsApi.get(name, PANEL_ID);
                return r.found ? r.value : null;
            },
            set: (name, value) => secretsApi.set(name, value, PANEL_ID),
            delete: (name) => secretsApi.delete(name, PANEL_ID),
            list: () => secretsApi.list(PANEL_ID),
        },
        // other panels' actions: this service's scoped credential, as any panel's flows use
        actions: {
            list: () => actionsApi.list(),
            call: (panel, action, inputs, o) => actionsApi.call(panel, action, inputs, { timeoutMs: o.timeoutMs }),
        },
    },
    // where the harnesses look for their own files: their documented overrides, else their defaults. The
    // harnesses run with this service's environment, so they and the panel agree on it.
    harnessHomes: {
        claude: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
        codex: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    },
};

const app = new AiApp(host);

function ui(id: string, name: string, run: (inputs: any) => Promise<unknown> | unknown): ActionDefinition {
    return defineAction({
        id,
        name,
        internal: true,
        description: name,
        inputs: {},
        run: async (_ctx, inputs) => {
            await app.ready();
            return run(inputs ?? {});
        },
    });
}

export const aiService = definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    actions: [
        ui(UI_ACTION_IDS.setup, "Save the agent's settings", (i) => app.setup(i)),
        ui(UI_ACTION_IDS.detect, "Find installed agent harnesses", () => app.detect()),
        ui(UI_ACTION_IDS.models, "List a brain's models", (i) => app.models(i)),
        ui(UI_ACTION_IDS.history, "Read the conversation", (i) => app.conversation.history(Number(i.limit) || undefined)),
        ui(UI_ACTION_IDS.send, "Send a message", (i) =>
            app.conversation.send(String(i.text ?? ""), i.replyTo === undefined || i.replyTo === null ? null : String(i.replyTo), i.attachments ?? []),
        ),
        ui(UI_ACTION_IDS.attachBegin, "Start uploading a file", (i) => app.conversation.attachments.begin(i.name, i.bytes)),
        ui(UI_ACTION_IDS.attachPut, "Upload part of a file", (i) => app.conversation.attachments.put(i.id, i.offset, i.data)),
        ui(UI_ACTION_IDS.attachFinish, "Finish uploading a file", (i) => app.conversation.attachments.finish(i.id)),
        ui(UI_ACTION_IDS.attachCancel, "Stop uploading a file", (i) => app.conversation.attachments.cancel(i.id)),
        ui(UI_ACTION_IDS.attachRead, "Read part of a file in the conversation", (i) => app.conversation.attachments.read(i.id, i.offset)),
        ui(UI_ACTION_IDS.installComputer, "Set up the agent's computer", () => app.installComputer()),
        ui(UI_ACTION_IDS.startComputer, "Start the agent's computer", () => app.startComputer()),
        ui(UI_ACTION_IDS.stopComputer, "Stop the agent's computer", () => app.stopComputer()),
        ui(UI_ACTION_IDS.windows, "List the computer's windows", () => app.windows()),
        ui(UI_ACTION_IDS.frame, "Show one of the computer's windows", (i) => app.frame(i)),
        ui(UI_ACTION_IDS.input, "Use one of the computer's windows", (i) => app.input(i)),
        ui(UI_ACTION_IDS.closeWindow, "Close one of the computer's windows", (i) => app.closeWindow(i)),
        ui(UI_ACTION_IDS.go, "Go somewhere in one of the computer's windows", (i) => app.go(i)),
        ui(UI_ACTION_IDS.unqueue, "Take back a waiting message", (i) => app.conversation.unqueue(String(i.id ?? ""))),
        ui(UI_ACTION_IDS.sendNow, "Interrupt the agent to read waiting messages", () => app.conversation.sendNow()),
        ui(UI_ACTION_IDS.startOver, "Start the conversation over", () => app.startOver()),
        ui(UI_ACTION_IDS.newConversation, "Start a new conversation, keeping this one in the history", () => app.newConversation()),
        ui(UI_ACTION_IDS.conversations, "List past conversations", () => app.conversation.past()),
        ui(UI_ACTION_IDS.openConversation, "Continue a past conversation", (i) => app.openConversation(i.id)),
        ui(UI_ACTION_IDS.deleteConversation, "Delete a past conversation", (i) => app.conversation.deletePast(i.id)),
        ui(UI_ACTION_IDS.memory, "List what the agent remembers", () => app.memory.list()),
        ui(UI_ACTION_IDS.deleteFact, "Forget a fact", (i) => app.memory.deleteFact(i.id)),
        ui(UI_ACTION_IDS.readNote, "Read a note from the agent's memory", (i) => app.memory.readNote(i.key)),
        ui(UI_ACTION_IDS.deleteNote, "Forget a note", (i) => app.memory.deleteNote(i.key)),
        ui(UI_ACTION_IDS.routines, "List the agent's routines", () => app.routines.list()),
        ui(UI_ACTION_IDS.deleteRoutine, "Stop one of the agent's routines", (i) => app.routines.remove(i.id)),
        ui(UI_ACTION_IDS.signInShot, "The picture of a sign-in the agent asked for", (i) => app.signIns.shot(i.id)),
        ui(UI_ACTION_IDS.signIn, "Sign in where the agent asked, with values it never sees", (i) => app.signIns.submit(i.id, i.values)),
        ui(UI_ACTION_IDS.declineSignIn, "Say no to a sign-in the agent asked for", (i) => app.signIns.decline(i.id)),
        ui(UI_ACTION_IDS.control, "Take or hand back control of the computer", (i) => app.control(i)),
        ui(TOOLS_ACTION_IDS.get, "Read the agent's tool servers", () => app.toolsView()),
        ui(TOOLS_ACTION_IDS.save, "Save a tool server", (i) => app.toolsSave(i)),
        ui(TOOLS_ACTION_IDS.remove, "Remove a tool server", (i) => app.toolsRemove(i)),
        ui(TOOLS_ACTION_IDS.restart, "Restart a tool server", (i) => app.toolsRestart(i)),
        ui(TOOLS_ACTION_IDS.setActions, "Allow or refuse Paperboard actions for the agent", (i) => app.toolsSetActions(i)),
        ui(TOOLS_ACTION_IDS.setSecret, "Save a tool server's secret", (i) => app.toolsSetSecret(i)),
        ui(TOOLS_ACTION_IDS.deleteSecret, "Delete a tool server's secret", (i) => app.toolsDeleteSecret(i)),
    ],
    async onInit(ctx) {
        await app.init({
            get state() {
                return ctx.state as AiState;
            },
            setState: (patch) => ctx.setState(patch),
            emit: (event, payload) => ctx.emit(event, payload),
        });
    },
});

// the daemon gives a stopping service a few seconds: the VM and any running
// turn are stopped and observed gone before the process exits
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
        void app.shutdown().finally(() => process.exit(0));
    });
}

export default aiService;
