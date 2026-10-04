import { buildMarketingFlows, validateMarketingFlow } from "./marketing-flows";
import { verifyMarketingFlows } from "./verify-marketing-flows";
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
} from "../../../packages/paperapi/src/index";

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
    // Read the actual library's resolved sibling icons in this browser host.
    await frame.waitForFunction(() => document.querySelectorAll("img").length >= 3);
    const sources = await frame.locator("img").evaluateAll(images => images.map(image => image.src));
    const icons = Object.fromEntries([...new Set(registry.map(item => item.panelId))]
        .filter(id => id !== panelId)
        .map(id => [id, sources.find(src => new URL(src).hostname.startsWith(`local.${id}.`))]));
    const flows = buildMarketingFlows(registry, icons as Record<string, string>);
    await verifyMarketingFlows(flows);
    let fixture = { flows: [flows.startup], notes: [], functions: [] };
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
        { name: "actions-overview.png", flows: [flows.startup, flows.leaving], shell: false, overview: true },
        { name: "actions.png", flows: [flows.model, flows.botReady], shell: true },
        { name: "gameserver-actions.png", flows: [flows.joined], shell: false },
        { name: "botcreator-actions.png", flows: [flows.button], shell: false },
        { name: "ai-actions.png", flows: [flows.question], shell: false },
        { name: "actions-game-flow.png", flows: [flows.startup], shell: false },
        { name: "actions-discord-flow.png", flows: [flows.member], shell: false },
        { name: "actions-ai-flow.png", flows: [flows.model], shell: false },
    ];
    const detail = await context.newPage();
    for (const shot of captures) {
        if (process.env.CAPTURE_SHOTS && !process.env.CAPTURE_SHOTS.split(",").includes(shot.name)) continue;
        // The schema stays real; each screenshot has its own purpose and data.
        fixture = { flows: structuredClone(shot.flows), notes: [], functions: [] };
        fixture.flows.forEach((flow, index) => {
            flow.pos = { x: shot.shell ? 20 + index * 510 : shot.overview ? 70 + index * 560 : 160, y: 70 };
            validateMarketingFlow(flow);
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
        await target.locator(".canvas-world img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
        assert.ok(await target.locator(".canvas-world img").evaluateAll(images => images.length > 0 && images.every(image => image.naturalWidth > 0)), "Real panel icons must load");
        await target.evaluate(() => document.fonts.ready);
        await (shot.shell ? page : shot.overview ? detail : closeup).screenshot({
            path: fileURLToPath(new URL(`../public/screens/${shot.name}`, import.meta.url)),
        });
        console.log(`Captured ${shot.name}: runtime-checked panel flows, loaded icons and valid references; external responses simulated.`);
    }

} finally {
    closeTransport("local");
    await closeupCapture?.close();
    await capture.close();
}
