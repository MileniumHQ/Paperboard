import { blocksApi, configApi, definePanelService, fileApi, packageApi, processApi, secretsApi, type CallHandlers } from "@mileniumhq/paperapi";
import { PANEL_ID, agentsContract } from "./contract";
import { AiApp, findProgram, type AppHost } from "./service/app";
import { fetchWebImage } from "./service/webImage";
import { browserView } from "./service/browserView";

// the tool servers and the blocks switch: another document, so one never overwrites the other
const TOOLS_PATH = "tools.json";

const host: AppHost = {
    start: (o) => processApi.start(o),
    kill: (id, signal) => processApi.kill(id, signal),
    closeInput: (id) => processApi.closeInput(id),
    exists: (id) => processApi.exists(id),
    onExit: (id, cb) => processApi.onExit(id, cb),
    // a harness's stdout is its protocol: stderr never mixes into it
    onStdout: (id, cb) => processApi.onStdout(id, cb),
    onStderr: (id, cb) => processApi.onStderr(id, cb),
    exec: (command, args, o) => processApi.exec(command, args, { timeoutMs: o?.timeoutMs, env: o?.env, cwd: o?.cwd }),
    packages: {
        isInstalled: (name) => packageApi.isInstalled(name),
        download: (name, onProgress) => packageApi.download(name, onProgress),
        getPath: (name) => packageApi.getPath(name),
        version: async (name) => {
            const record = (await packageApi.getIndex())[name];
            const version = typeof record === "string" ? record : record?.version;
            return typeof version === "string" ? version : null;
        },
        updateWaiting: async (name) => (await packageApi.pendingUpdates()).some((u) => u.name === name),
    },
    storageDir: () => fileApi.getPath("", PANEL_ID),
    readSettings: () => configApi.get(PANEL_ID),
    writeSettings: async (s) => {
        await configApi.set(s, PANEL_ID);
    },
    findProgram,
    tools: {
        write: (id, data) => processApi.write(id, data),
        readTools: () => configApi.get(PANEL_ID, TOOLS_PATH),
        writeTools: async (c) => {
            await configApi.set(c, PANEL_ID, TOOLS_PATH);
        },
        // this panel's vault entries only, the panel id explicit on every call
        vault: {
            get: async (name) => {
                const r = await secretsApi.get(name, PANEL_ID);
                return r.found ? r.value : null;
            },
            set: async (name, value) => {
                await secretsApi.set(name, value, PANEL_ID);
            },
            delete: (name) => secretsApi.delete(name, PANEL_ID),
            list: () => secretsApi.list(PANEL_ID),
        },
        // other panels' blocks: this service's scoped credential, as the Blocks panel's flows use
        blocks: {
            list: () => blocksApi.list(),
            projects: () => blocksApi.projects(),
            run: (panel, command, inputs, o) => blocksApi.run(panel, command, inputs, o),
            read: (panel, value, inputs, o) => blocksApi.read(panel, value, inputs, o),
            property: (type, field, value, o) => blocksApi.property(type, field, value, o),
            choices: (panel, entry, input, o) => blocksApi.choices(panel, entry, input, o),
            typeChoices: (type, o) => blocksApi.typeChoices(type, o),
        },
    },
    blocks: blocksApi.panel(PANEL_ID),
};

const app = new AiApp(host);

// a call waits for the service to start, and fails with why it didn't
const ready =
    <I, O>(run: (input: I) => O | Promise<O>) =>
    async (input: I): Promise<O> => {
        await app.ready();
        return run(input);
    };

const calls: CallHandlers<typeof agentsContract> = {
    setup: ready(async (i) => void (await app.setup(i))),
    keepOnboarding: ready((i) => void app.keepOnboarding(i)),
    installBrain: ready(async (i) => void (await app.installBrain(i))),
    signInBrain: ready(async (i) => void (await app.signInBrain(i))),
    brainCode: ready(async (i) => void (await app.brainCode(i))),
    brainAddress: ready(async (i) => void (await app.brainAddress(i))),
    cancelBrainSignIn: ready(async (i) => void (await app.cancelBrainSignIn(i))),
    signOutBrain: ready(async (i) => void (await app.signOutBrain(i))),
    models: ready((i) => app.models(i)),
    usage: ready((i) => app.usage(i)),
    providers: ready(() => app.providers.list()),
    connectKey: ready((i) => app.providers.connectKey(i.provider, i.key, i.answer)),
    beginProvider: ready((i) => app.providers.begin(i.provider, i.method, i.answer)),
    providerAttempt: ready((i) => app.providers.attempt(i.provider, i.attempt, i.code)),
    cancelProvider: ready((i) => app.providers.cancel(i.provider, i.attempt)),
    disconnectProvider: ready((i) => app.providers.disconnect(i.credential)),
    history: ready((i) => app.conversation.history(i.limit)),
    send: ready((i) => app.conversation.send(i.text, i.replyTo ?? null, i.attachments)),
    startOver: ready(async () => void (await app.startOver())),
    newConversation: ready(async () => void (await app.newConversation())),
    conversations: ready(() => ({ current: app.conversation.current(), past: app.conversation.past() })),
    openConversation: ready(async (i) => void (await app.openConversation(i.id))),
    deleteConversation: ready((i) => void app.deleteConversation(i.id)),
    attachBegin: ready((i) => app.conversation.attachments.begin(i.name, i.bytes)),
    attachPut: ready((i) => void app.conversation.attachments.put(i.id, i.offset, i.data)),
    attachFinish: ready((i) => app.conversation.attachments.finish(i.id)),
    attachCancel: ready((i) => void app.conversation.attachments.cancel(i.id)),
    attachRead: ready((i) => app.conversation.attachments.read(i.id, i.offset)),
    attachInfo: ready((i) => app.conversation.attachments.get(i.id)),
    webImage: ready((i) => fetchWebImage(i.url)),
    installComputer: ready(() => void app.installComputer()),
    startComputer: ready(() => void app.startComputer()),
    stopComputer: ready(async () => void (await app.stopComputer())),
    windows: ready(() => browserView.windows(app.computer)),
    frame: ready((i) => browserView.frame(app.computer, i)),
    input: ready((i) => browserView.input(app.computer, i)),
    closeWindow: ready(async (i) => void (await browserView.close(app.computer, i))),
    go: ready(async (i) => void (await browserView.go(app.computer, i))),
    control: ready((i) => void app.control(i)),
    memory: ready(() => app.memory.list()),
    deleteFact: ready((i) => app.memory.deleteFact(i.id)),
    readNote: ready((i) => app.memory.readNote(i.key)),
    deleteNote: ready((i) => app.memory.deleteNote(i.key)),
    routines: ready(() => app.routines.list()),
    deleteRoutine: ready(async (i) => void (await app.routines.remove(i.id))),
    signInShot: ready((i) => app.signIns.shot(i.id)),
    signIn: ready(async (i) => void (await app.signIns.submit(i.id, i.values))),
    declineSignIn: ready((i) => void app.signIns.decline(i.id)),
    answerPrompt: ready(async (i) => void (await app.prompts.answer(i.id, i.values))),
    declinePrompt: ready((i) => void app.prompts.decline(i.id)),
    access: ready(() => app.access.view()),
    answerAccess: ready((i) => void app.access.answer(i.id, i.how)),
    revokeAccess: ready((i) => app.access.revoke(i.grant)),
    answerToolServer: ready(async (i) => void (await app.serverTools.answer(i.id, i.allow))),
    pages: ready(() => app.pages.list()),
    openPage: ready((i) => app.pages.open(i.name)),
    pagePicture: ready((i) => app.pages.pictureOf(i.name)),
    pagePdf: ready((i) => app.pages.pdf(i.name)),
    discardPagePdf: ready((i) => app.pages.discardPdf(i.file)),
    deletePage: ready(async (i) => void (await app.pages.remove(i.name))),
    tools: ready(() => app.servers.view()),
    readToolsFile: ready(() => app.servers.reload()),
    saveServer: ready((i) => app.servers.save(i.server)),
    removeServer: ready((i) => app.servers.remove(i.name)),
    restartServer: ready((i) => app.servers.restart(i.name)),
    setBlocks: ready((i) => app.servers.setBlocks(i.on)),
    setSecret: ready((i) => app.servers.setSecret(i.server, i.name, i.value)),
    signInServer: ready((i) => app.servers.signIn(i.name)),
    finishServerSignIn: ready((i) => app.servers.finishSignIn(i.name, i.address)),
    cancelServerSignIn: ready((i) => app.servers.cancelSignInFor(i.name)),
};

export const aiService = definePanelService({
    contract: agentsContract,
    calls,
    async onInit(ctx) {
        await app.init({
            get state() {
                return ctx.state;
            },
            setState: (patch) => ctx.setState(patch),
            emit: (event, payload) => ctx.emit(event, payload),
        });
    },
});

// the daemon gives a stopping service a few seconds: the browser and any running
// turn are stopped and observed gone before the process exits
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
        void app.shutdown().finally(() => process.exit(0));
    });
}

export default aiService;
