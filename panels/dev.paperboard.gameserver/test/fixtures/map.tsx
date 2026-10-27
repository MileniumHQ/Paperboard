// Build with map.vite.ts and open /test/fixtures/map.html. The real Map tab with one player
// standing at the middle of the only region: the marker must draw in the theme's danger
// colour. A canvas ignores "var(--paper-danger)", so an unresolved token draws in black.
import { render } from "solid-js/web";
import { PaperProvider, getVar } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";

actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string) => {
    if (action === "list-map-regions") {
        return { levelName: "world", dimensions: [{ dimension: "overworld", regions: [{ x: 0, z: 0 }] }] };
    }
    return null;
}) as typeof actionsApi.call;
const { setPlayerPositions } = await import("../../src/lib/players");
// the view centres on the region, so a player at its middle sits at the canvas centre
setPlayerPositions(new Map([["steve", { x: 256, y: 64, z: 256, dimension: "minecraft:overworld" }]]));

const { default: MapView } = await import("../../src/components/Map");
const root = document.getElementById("app")!;
const dispose = render(() => <PaperProvider><MapView /></PaperProvider>, root);
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
try {
    const canvas = root.querySelector("canvas")!;
    const expected = getVar("danger").toLowerCase();
    let seen = "";
    for (let i = 0; i < 100 && seen !== expected; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const [r, g, b, a] = canvas.getContext("2d")!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        seen = a === 0 ? "transparent" : hex(r, g, b);
    }
    if (seen !== expected) throw new Error(`the marker drew ${seen}, not the danger colour ${expected}`);
    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
