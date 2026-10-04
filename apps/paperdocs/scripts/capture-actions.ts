import { captureBrowser } from "./capture-browser.mjs";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
    actions,
    config,
    initPaperApi,
    closeTransport,
} from "../../../packages/paperapi/dist/paperapi.es.js";
import { BUILTIN_DEFS } from "../../../panels/dev.paperboard.actions/src/lib/builtin";
import {
    isCanvasBlock,
    type CanvasBlock,
} from "../../../panels/dev.paperboard.actions/src/lib/tree";
import assert from "node:assert/strict";

// Build screenshot flows from the real builtin schemas, then execute through
// the authenticated SDK/daemon. This is separate from the simulated online
// data in capture-demo.mjs: these flows really work.
if (!process.env.PAPERBOARD_DIR) throw new Error("Set a temporary PAPERBOARD_DIR.");
const fixtureDir = realpathSync(process.env.PAPERBOARD_DIR);
if (!fixtureDir.startsWith(realpathSync(tmpdir()) + sep))
    throw new Error("Use a temporary install.");
const expectedPort = JSON.parse(readFileSync(join(fixtureDir, "local/crane.json"), "utf8")).port;
const panelId = "dev.paperboard.actions";
const block = (
    id: string,
    actionId: string,
    values: Record<string, unknown> = {},
    children?: CanvasBlock[],
): CanvasBlock => {
    const definition = BUILTIN_DEFS.find((def) => def.id === actionId);
    if (!definition?.item.schema) throw new Error(`No schema for ${actionId}`);
    return {
        id,
        panelId: definition.item.panelId,
        action: definition.item.schema,
        isTrigger: actionId === "on-play",
        pos: { x: 0, y: 0 },
        values,
        ...(children ? { children } : {}),
    };
};
const resultOf = (source: CanvasBlock) => {
    const output = source.action.output;
    const label = typeof output === "string" ? output : output?.label || "Result";
    return `{{${source.id}:${label}:${source.action.icon || ""}}}`;
};
const text = block("welcome-text", "text", { value: "Welcome to our Minecraft world!" });
const upper = block("welcome-uppercase", "text-uppercase", { text: resultOf(text) });
const welcome = block("welcome-flow", "on-play", {}, [
    text,
    upper,
    block("welcome-log", "log-console", { message: resultOf(upper) }),
]);
const calculation = block("capacity-maths", "math-calculate", { expression: "4 * 1024" });
const branch = block(
    "capacity-branch",
    "if-else",
    { left: resultOf(calculation), operator: ">", right: "2048" },
    [block("capacity-good", "log-console", { message: "Enough memory for game night!" })],
);
branch.elseChildren = [
    block("capacity-low", "log-console", { message: "Allocate more memory before starting." }),
];
const capacity = block("capacity-flow", "on-play", {}, [calculation, branch]);
welcome.pos = { x: 120, y: 180 };
capacity.pos = { x: 500, y: 180 };
const fixture = { flows: [welcome, capacity], functions: [], notes: [] };
const check = (item: CanvasBlock) => {
    assert.ok(isCanvasBlock(item));
    for (const [key, input] of Object.entries(item.action.inputs || {})) {
        if (input.required)
            assert.ok(
                item.values[key] !== undefined && String(item.values[key]).trim(),
                `${item.id} needs ${key}`,
            );
        if (input.type === "select" && item.values[key] !== undefined)
            assert.ok(
                input.options?.some((option) =>
                    typeof option === "object"
                        ? option.value === item.values[key]
                        : option === item.values[key],
                ),
            );
    }
    for (const child of [...(item.children || []), ...(item.elseChildren || [])]) check(child);
};
fixture.flows.forEach(check);
const root = fileURLToPath(new URL("../public/screens/", import.meta.url));
const capture = await captureBrowser(1.25);
const context = capture.context;
try {
    const page = await context.newPage();
    await page.goto(process.env.PAPERBOARD_BROWSER_ORIGIN || "http://paperboard.localhost:4319");
    await page.getByText("Actions", { exact: true }).click();
    const frame = await (await page
        .locator(`iframe[title="${panelId}"]`)
        .elementHandle())!.contentFrame();
    if (!frame) throw new Error("No Actions frame");
    await frame.locator(".canvas-world").waitFor();
    const grant = await frame.evaluate(() => (window as any).__PAPERBOARD_CRANE);
    assert.equal(grant.port, expectedPort, "Refusing a daemon outside the temporary install");
    await initPaperApi({ ...grant, computerId: "local" });
    await config.set(fixture, panelId, "canvas.json");
    await actions.call(panelId, "sync-flows", fixture);
    await frame.goto(frame.url());
    await frame.locator(".canvas-world > .triggerAction").first().waitFor();
    await frame.getByTitle("Collapse Library").click();
    for (const flow of fixture.flows) {
        const log = await actions.call<any>(panelId, "test-run-flow", { triggerBlockId: flow.id });
        assert.equal(log.status, "success");
        assert.equal(
            log.steps.at(-1).result,
            flow.id === welcome.id
                ? "WELCOME TO OUR MINECRAFT WORLD!"
                : "Enough memory for game night!",
        );
        console.log(`executed ${flow.id}: ${log.status}`);
    }
    const bounds = await frame
        .locator(".canvas-world > .triggerAction")
        .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().toJSON()),
        );
    const size = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.equal(bounds.length, 2);
    assert.ok(bounds[0].right + 20 < bounds[1].left, "Flows must not overlap");
    assert.ok(
        bounds.every(
            (rect) => rect.left >= 0 && rect.right <= size.width && rect.bottom <= size.height,
        ),
        `Flows must not clip: ${JSON.stringify({ bounds, size })}`,
    );
    await page.screenshot({ path: root + "actions.png" });
    await frame.getByTitle("Open Actions Library").click();
    await frame.getByText("AI", { exact: true }).click();
    await page.screenshot({ path: root + "actions-library.png" });
    const closeupCapture = await captureBrowser(2);
    const detail = await closeupCapture.context.newPage();
    try {
        for (const [index, name] of [
            [0, "actions-flow"],
            [1, "actions-logic"],
        ] as const) {
            const single = {
                ...fixture,
                flows: [{ ...fixture.flows[index], pos: { x: 100, y: 90 } }],
            };
            await config.set(single, panelId, "canvas.json");
            await detail.goto(frame.url());
            await detail.locator(".canvas-world > .triggerAction").waitFor();
            await detail.getByTitle("Collapse Library").click();
            await actions.call(panelId, "sync-flows", single);
            const log = await actions.call<any>(panelId, "test-run-flow", {
                triggerBlockId: single.flows[0].id,
            });
            assert.equal(log.status, "success");
            await detail.waitForTimeout(300);
            const bound = await detail.locator(".canvas-world > .triggerAction").boundingBox();
            const closeupSize = await detail.evaluate(() => ({ width: innerWidth, height: innerHeight }));
            assert.ok(
                bound &&
                    bound.x >= 0 &&
                    bound.x + bound.width <= closeupSize.width &&
                    bound.y + bound.height <= closeupSize.height,
                "Close-up must not clip",
            );
            await detail.screenshot({ path: root + name + ".png" });
        }
    } finally {
        await closeupCapture.close();
    }
    await config.set(fixture, panelId, "canvas.json");
    await actions.call(panelId, "sync-flows", fixture);
} finally {
    closeTransport("local");
    await capture.close();
}
