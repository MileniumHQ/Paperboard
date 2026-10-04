import { BUILTIN_DEFS } from "../../../panels/dev.paperboard.actions/src/lib/builtin";
import { captureBrowser } from "./capture-browser.mjs";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
    actions,
    initPaperApi,
    closeTransport,
} from "../../../packages/paperapi/dist/paperapi.es.js";
import {
    isCanvasBlock,
    type CanvasBlock,
} from "../../../panels/dev.paperboard.actions/src/lib/tree";

if (!process.env.PAPERBOARD_DIR) throw new Error("Use a temporary PAPERBOARD_DIR.");
const fixtureDir = realpathSync(process.env.PAPERBOARD_DIR);
assert.ok(fixtureDir.startsWith(realpathSync(tmpdir()) + sep));
const expectedPort = JSON.parse(readFileSync(join(fixtureDir, "local/crane.json"), "utf8")).port;
const panelId = "dev.paperboard.actions";
const capture = await captureBrowser(1.25);
const context = capture.context;
let closeupCapture: Awaited<ReturnType<typeof captureBrowser>> | undefined;
try {
    const page = await context.newPage();
    await page.goto(process.env.PAPERBOARD_BROWSER_ORIGIN || "http://paperboard.localhost:4319");
    await page.getByText("Actions", { exact: true }).click();
    const frame = await (await page
        .locator(`iframe[title="${panelId}"]`)
        .elementHandle())!.contentFrame();
    assert.ok(frame);
    await frame.waitForFunction(() => Boolean((window as any).__PAPERBOARD_CRANE));
    const grant = await frame.evaluate(() => (window as any).__PAPERBOARD_CRANE);
    assert.equal(grant.port, expectedPort);
    await initPaperApi({ ...grant, computerId: "local" });
    const registry = await actions.list();
    const block = (
        id: string,
        source: string,
        action: string,
        values: Record<string, unknown>,
        children?: CanvasBlock[],
    ): CanvasBlock => {
        const record = registry.find((item) => item.panelId === source && item.action === action)
            || (source === panelId ? { schema: BUILTIN_DEFS.find(item => item.id === action)?.item.schema } : undefined);
        assert.ok(record?.schema, `Missing real action ${source}:${action}`);
        return {
            id,
            panelId: source,
            action: record.schema,
            isTrigger: action === "on-play" || Boolean(record.schema.eventOnly),
            pos: { x: 0, y: 0 },
            values,
            ...(children ? { children } : {}),
        };
    };
    const channel = "124800000000000010"; // syntactically valid demo channel, never sent to Discord
    assert.match(channel, /^\d{17,20}$/);
    const started = block("announce-start", "dev.paperboard.gameserver", "server-started", {}, [
        block("send-ready", "dev.paperboard.botcreator", "send-message", {
            channel,
            content: "Minecraft is online. Join us for game night!",
        }),
    ]);
    const joined = block(
        "welcome-player",
        "dev.paperboard.gameserver",
        "player-joined",
        { player: "" },
        [
            block("welcome-chat", "dev.paperboard.gameserver", "say-chat", {
                message: "Welcome! Meet everyone at spawn.",
            }),
            block("send-joined", "dev.paperboard.botcreator", "send-message", {
                channel,
                content: "Someone joined the Minecraft server.",
            }),
        ],
    );
    const answer = block("ai-answer", "dev.paperboard.ai", "ask", {
        prompt: "Write a short welcome for our Minecraft players.",
        model: "", personality: "standard",
    });
    const resultOf = (item: CanvasBlock) => {
        const output = item.action.output;
        const label = typeof output === "string" ? output : output?.label || "Result";
        return `{{${item.id}:${label}:${item.action.icon || "bolt"}}}`;
    };
    const aiWelcome = block("ai-welcome", panelId, "on-play", {}, [answer,
        block("ai-chat", "dev.paperboard.gameserver", "say-chat", { message: resultOf(answer) }),
    ]);
    const interaction = "{{interactionId:Interaction:reply}}";
    const discordButton = block("discord-button", "dev.paperboard.botcreator", "interaction-triggered", {
        customId: "announce-game-night",
    }, [
        block("acknowledge", "dev.paperboard.botcreator", "defer-interaction", { interactionId: interaction, ephemeral: true }),
        block("announce-game", "dev.paperboard.gameserver", "say-chat", { message: "Game night starts at spawn in ten minutes!" }),
        block("button-response", "dev.paperboard.botcreator", "respond-to-interaction", {
            interactionId: interaction, content: "Announcement sent to Minecraft.", ephemeral: true,
        }),
    ]);
    const discordWelcome = block("welcome-member", "dev.paperboard.botcreator", "on-member-join", {}, [
        block("welcome-dm", "dev.paperboard.botcreator", "send-dm", {
            user: "{{userId:User:person}}", content: "Welcome! Our Minecraft address is play.example.com.",
        }),
        block("welcome-channel", "dev.paperboard.botcreator", "send-message", {
            channel, content: "A new member joined. Say hello in the welcome channel!",
        }),
    ]);
    const modelReady = block("model-ready", "dev.paperboard.ai", "model-downloaded", { model: "" }, [
        block("model-notify", "dev.paperboard.botcreator", "send-message", {
            channel, content: "The local AI model is ready for game night.",
        }),
    ]);
    let fixture = { flows: [started, joined], notes: [], functions: [] };
    const check = (item: CanvasBlock) => {
        assert.ok(isCanvasBlock(item));
        for (const [key, input] of Object.entries(item.action.inputs || {})) {
            if (input.required)
                assert.ok(
                    item.values[key] !== undefined && String(item.values[key]).trim(),
                    `${item.id} needs ${key}`,
                );
        }
        item.children?.forEach(check);
    };
    fixture.flows.forEach(check);
    // Confine preview persistence and flow subscriptions to this Chrome context.
    // Never register these event flows or send their messages on the daemon.
    const installFixtureRoutes = async (activeContext: typeof context) => activeContext.routeWebSocket(
        (url) => Number(url.port) === expectedPort,
        (socket) => {
            const server = socket.connectToServer();
            socket.onMessage((message) => {
                let request;
                try {
                    request = JSON.parse(message.toString());
                } catch {
                    server.send(message);
                    return;
                }
                const params = request.params || {};
                let replacement;
                if (
                    request.action === "config:get" &&
                    params.id === panelId &&
                    params.path === "canvas.json"
                )
                    replacement = { data: fixture };
                if (request.action === "config:set" && params.id === panelId) replacement = {};
                if (
                    request.action === "actions:call" &&
                    params.panelId === panelId &&
                    params.action === "sync-flows"
                )
                    replacement = { result: {} };
                if (replacement !== undefined)
                    socket.send(
                        JSON.stringify({ type: "response", id: request.id, result: replacement }),
                    );
                else server.send(message);
            });
            server.onMessage((message) => socket.send(message));
        },
    );
    await installFixtureRoutes(context);
    closeupCapture = await captureBrowser(2);
    await installFixtureRoutes(closeupCapture.context);
    const closeup = await closeupCapture.context.newPage();
    const captures = [
        { name: "actions-overview.png", flows: [discordWelcome, modelReady], shell: false, overview: true },
        { name: "actions.png", flows: [started, aiWelcome], shell: true },
        { name: "gameserver-actions.png", flows: [joined], shell: false },
        { name: "botcreator-actions.png", flows: [discordButton], shell: false },
        { name: "ai-actions.png", flows: [aiWelcome], shell: false },
        { name: "actions-game-flow.png", flows: [started], shell: false },
        { name: "actions-discord-flow.png", flows: [discordWelcome], shell: false },
        { name: "actions-ai-flow.png", flows: [modelReady], shell: false },
    ];
    const detail = await context.newPage();
    for (const shot of captures) {
        if (process.env.CAPTURE_SHOTS && !process.env.CAPTURE_SHOTS.split(",").includes(shot.name)) continue;
        // The schema stays real; each screenshot has its own purpose and data.
        fixture = { flows: structuredClone(shot.flows), notes: [], functions: [] };
        fixture.flows.forEach((flow, index) => {
            flow.pos = { x: shot.shell || shot.overview ? 70 + index * 560 : 180, y: 100 };
            check(flow);
            const available = new Set(Object.keys(flow.action.outputFields || {}));
            const visit = (item: CanvasBlock) => {
                for (const value of Object.values(item.values)) {
                    if (typeof value !== "string") continue;
                    for (const match of value.matchAll(/\{\{([^}:]+):[^}]+\}\}/g))
                        assert.ok(available.has(match[1]), `Invalid variable ${match[1]}`);
                }
                available.add(item.id);
                item.children?.forEach(visit);
            };
            visit(flow);
        });
        const target = shot.shell ? frame : shot.overview ? detail : closeup;
        await target.goto(frame.url());
        await target.locator(".canvas-world > .triggerAction").first().waitFor();
        await target.getByTitle("Collapse Library").click();
        const bounds = await target.locator(".canvas-world > .triggerAction").evaluateAll(elements =>
            elements.map(element => element.getBoundingClientRect().toJSON()));
        const size = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        console.log(shot.name, bounds.map(rect => ({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom})), size);
        assert.equal(bounds.length, fixture.flows.length);
        assert.ok(bounds.every(rect => rect.left >= 0 && rect.top >= 0 && rect.right <= size.width && rect.bottom <= size.height), `${shot.name} must not clip`);
        if (bounds.length > 1) assert.ok(bounds[0].right + 20 < bounds[1].left, "Flows must not overlap");
        await (shot.shell ? page : shot.overview ? detail : closeup).screenshot({
            path: fileURLToPath(new URL(`../public/screens/${shot.name}`, import.meta.url)),
        });
        console.log(`Captured ${shot.name}: real panel schemas and valid references; no external actions executed.`);
    }

} finally {
    closeTransport("local");
    await closeupCapture?.close();
    await capture.close();
}
