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
import type { CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";
import type { CanvasSaveResult, CanvasSnapshot } from "../../../panels/dev.paperboard.actions/src/lib/canvasDoc";

// The learn pages' cross-panel Actions workflows. Each screenshot's flows are
// saved as a real Actions project in the temporary install, opened in the
// real editor, captured, and deleted again. The install needs one Minecraft
// server, added in Game Server, for that server's blocks. It is never set up
// or started, and Agents has no brain, so the flows' events never come: they
// run only in verifyMarketingFlows, against simulated answers.
if (!process.env.PAPERBOARD_DIR) throw new Error("Use a temporary PAPERBOARD_DIR.");
const fixtureDir = realpathSync(process.env.PAPERBOARD_DIR);
assert.ok(fixtureDir.startsWith(realpathSync(tmpdir()) + sep), "PAPERBOARD_DIR must be a temporary install");
const expectedPort = JSON.parse(readFileSync(join(fixtureDir, "local/crane.json"), "utf8")).port;
const panelId = "dev.paperboard.actions";
const capture = await captureBrowser(1.25);
let closeupCapture: Awaited<ReturnType<typeof captureBrowser>> | undefined;
const made: string[] = [];
const call = <T>(action: string, inputs: Record<string, unknown> = {}) => actions.call<T>(panelId, action, inputs);
try {
    const page = await capture.context.newPage();
    await page.goto(process.env.PAPERBOARD_BROWSER_ORIGIN || "http://paperboard.localhost:4319");
    // The Panels widget re-renders with live stats, so click the row in the page
    // instead of waiting for it to hold still.
    await page.getByRole("button", { name: /^Actions(, running)?\. Open$/ }).evaluate((button: HTMLElement) => button.click());
    const frame = await (await page
        .locator(`iframe[title="${panelId}"]`)
        .elementHandle())!.contentFrame();
    assert.ok(frame);
    // The host shows a panel's tutorial the first time it opens; once closed,
    // the install remembers it.
    const tutorial = page.getByRole("dialog").filter({ hasText: "Snap blocks together" });
    if (await tutorial.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
        await tutorial.getByRole("button", { name: /close/i }).first().click();
        await tutorial.waitFor({ state: "hidden" });
    }
    await frame.waitForFunction(() => Boolean((window as any).__PAPERBOARD_CRANE));
    const grant = await frame.evaluate(() => (window as any).__PAPERBOARD_CRANE);
    assert.equal(grant.port, expectedPort);
    // Projects are the Actions panel's own: its grant may make and delete them.
    await initPaperApi({ ...grant, computerId: "local" });
    const registry = await actions.list();

    closeupCapture = await captureBrowser(2);
    const closeup = await closeupCapture.context.newPage();
    const openProject = async (name: string) => {
        await closeup.goto(frame.url());
        await closeup.getByText(name, { exact: true }).click();
        await closeup.locator(".canvas-world").waitFor();
    };
    const makeProject = async (name: string, flows: CanvasBlock[]) => {
        const project = await call<{ id: string }>("create-project", { name });
        made.push(project.id);
        const { revision } = await call<CanvasSnapshot>(`${project.id}/get-canvas`);
        const saved = await call<CanvasSaveResult>(`${project.id}/save-canvas`, {
            canvas: { flows, notes: [], functions: [] },
            baseRevision: revision,
            clientId: "marketing-capture",
        });
        assert.ok(!saved.applyError, `${name}: ${saved.applyError}`);
        return project.id;
    };

    // The flows carry each panel's icon as the Library resolves it in this
    // browser host, so read them from a new project's Library. A new project
    // left without a flow is a draft, which Actions discards on its own.
    await frame.getByRole("button", { name: "New project" }).first().click();
    await frame.waitForFunction(() => document.querySelectorAll("img").length >= 3);
    const sources = await frame.locator("img").evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    const icons = Object.fromEntries([...new Set(registry.map(item => item.panelId))]
        .filter(id => id !== panelId)
        .map(id => [id, sources.find(src => new URL(src).hostname.startsWith(`local.${id}.`))]));
    const flows = buildMarketingFlows(registry, icons as Record<string, string>);
    await verifyMarketingFlows(flows);

    const captures = [
        { name: "gameserver-flow.png", project: "Welcome players", flows: [flows.joined] },
        { name: "agents-flow.png", project: "Daily build challenge", flows: [flows.startup] },
    ];
    for (const shot of captures) {
        if (process.env.CAPTURE_SHOTS && !process.env.CAPTURE_SHOTS.split(",").includes(shot.name)) continue;
        const shotFlows = structuredClone(shot.flows);
        shotFlows.forEach((flow) => {
            flow.pos = { x: 160, y: 30 };
            validateMarketingFlow(flow);
        });
        await makeProject(shot.project, shotFlows);
        await openProject(shot.project);
        await closeup.locator(".canvas-world > .triggerAction").first().waitFor();
        await closeup.getByTitle("Collapse Library").click();
        const bounds = await closeup.locator(".canvas-world > .triggerAction").evaluateAll(elements =>
            elements.map(element => element.getBoundingClientRect().toJSON()));
        const size = await closeup.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        assert.equal(bounds.length, shotFlows.length);
        assert.ok(bounds.every(rect => rect.left >= 0 && rect.top >= 0 && rect.right <= size.width && rect.bottom <= size.height), `${shot.name} must not clip`);
        await closeup.locator(".canvas-world img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
        assert.ok(await closeup.locator(".canvas-world img").evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).naturalWidth > 0)), "Real panel icons must load");
        await closeup.evaluate(() => document.fonts.ready);
        assert.ok(await closeup.locator('.actionVariableOnly[data-has-value="true"]').evaluateAll(fields =>
            fields.every(field => {
                const copy = field.cloneNode(true) as HTMLElement;
                const chips = copy.querySelectorAll('.actionVariableChip');
                if (!chips.length) return false;
                chips.forEach(chip => chip.remove());
                return !copy.textContent!.replace(/[​﻿\s]/g, '');
            }),
        ), "Every populated variable-only field must contain real typed chips, never raw IDs");
        await closeup.screenshot({
            path: fileURLToPath(new URL(`../public/screens/${shot.name}`, import.meta.url)),
        });
        console.log(`Captured ${shot.name}: a project in the real editor, with checked flows and loaded icons.`);
    }
} finally {
    // A project this made is the install's, not the reader's: remove each one.
    const failures: unknown[] = [];
    for (const project of made) await call("delete-project", { project }).catch((error) => failures.push(error));
    closeTransport("local");
    await closeupCapture?.close();
    await capture.close();
    if (failures.length) throw new AggregateError(failures, "Could not delete the capture's projects");
}
