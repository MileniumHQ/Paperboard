import { configApi, defineAction, definePanelService, fileApi, processApi, secretsApi, type ActionDefinition } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, PANEL_ID, UI_ACTION_IDS, type AiState } from "./contract";
import { AiApp, which, type AppHost } from "./service/app";

// the agent's settings: their own document, apart from the panel's config document
const SETTINGS_PATH = "agent.json";

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
    getSecret: async (name) => {
        const r = await secretsApi.get(name, PANEL_ID);
        return r.found ? r.value : null;
    },
    setSecret: (name, value) => secretsApi.set(name, value, PANEL_ID),
    storageDir: () => fileApi.getPath("", PANEL_ID),
    readSettings: () => configApi.get(PANEL_ID, SETTINGS_PATH),
    writeSettings: (s) => configApi.set(s, PANEL_ID, SETTINGS_PATH),
    which,
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
        ui(UI_ACTION_IDS.history, "Read the conversation", (i) => app.conversation.history(Number(i.limit) || undefined)),
        ui(UI_ACTION_IDS.send, "Send a message", (i) => app.conversation.send(String(i.text ?? ""))),
        ui(UI_ACTION_IDS.stop, "Stop the agent", () => app.conversation.stop()),
        ui(UI_ACTION_IDS.installComputer, "Set up the agent's computer", (i) => app.installComputer(i)),
        ui(UI_ACTION_IDS.startComputer, "Start the agent's computer", () => app.startComputer()),
        ui(UI_ACTION_IDS.stopComputer, "Stop the agent's computer", () => app.stopComputer()),
        ui(UI_ACTION_IDS.windows, "List the computer's windows", () => app.windows()),
        ui(UI_ACTION_IDS.frame, "Show one of the computer's windows", (i) => app.frame(i)),
        ui(UI_ACTION_IDS.input, "Use one of the computer's windows", (i) => app.input(i)),
        ui(UI_ACTION_IDS.closeWindow, "Close one of the computer's windows", (i) => app.closeWindow(i)),
        ui(UI_ACTION_IDS.unqueue, "Take back a waiting message", (i) => app.conversation.unqueue(String(i.id ?? ""))),
        ui(UI_ACTION_IDS.sendNow, "Interrupt the agent to read waiting messages", () => app.conversation.sendNow()),
        ui(UI_ACTION_IDS.startOver, "Start the conversation over", () => app.startOver()),
        ui(UI_ACTION_IDS.setMemory, "Change the computer's memory", (i) => app.setMemory(i)),
        ui(UI_ACTION_IDS.control, "Take or hand back control of the computer", (i) => app.control(i)),
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
