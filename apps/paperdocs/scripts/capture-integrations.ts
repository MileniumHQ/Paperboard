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
        const record = registry.find((item) => item.panelId === source && item.action === action);
        assert.ok(record?.schema, `Missing real action ${source}:${action}`);
        return {
            id,
            panelId: source,
            action: record.schema,
            isTrigger: Boolean(record.schema.eventOnly),
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
    started.pos = { x: 200, y: 80 };
    joined.pos = { x: 200, y: 430 };
    const fixture = { flows: [started, joined], notes: [], functions: [] };
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
    await context.routeWebSocket(
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
    await frame.goto(frame.url());
    await frame.locator(".canvas-world > .triggerAction").first().waitFor();
    await frame.getByTitle("Collapse Library").click();
    const bounds = await frame
        .locator(".canvas-world > .triggerAction")
        .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().toJSON()),
        );
    const size = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.equal(bounds.length, 2);
    assert.ok(bounds[0].bottom + 20 < bounds[1].top, "Integration examples must not overlap");
    assert.ok(
        bounds.every(
            (rect) => rect.left >= 0 && rect.right <= size.width && rect.bottom <= size.height,
        ),
    );
    await page.screenshot({
        path: fileURLToPath(new URL("../public/screens/actions-library.png", import.meta.url)),
    });
    console.log(
        "Captured valid Minecraft → Discord example flows without registering events or sending messages.",
    );
} finally {
    closeTransport("local");
    await capture.close();
}
