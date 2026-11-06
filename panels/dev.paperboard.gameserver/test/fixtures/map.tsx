// Opened as map.html?server=s1 by test/mapView.test.ts. The real Map tab on a new world:
// one generated chunk in a corner of its region, and a player standing in its middle. The
// map opens on that chunk, so the marker is at the canvas centre (it was opened on the
// region's middle, with the chunk small and off to one side), drawn in the theme's danger
// colour. A canvas ignores "var(--paper-danger)", so an unresolved token draws in black.
import { render } from "solid-js/web";
import { PaperProvider, getVar } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";

actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string) => {
    // every action is the open server's, named "<server>/<action>"
    if (action.endsWith("/list-map-regions")) {
        return { levelName: "world", dimensions: [{ dimension: "overworld", regions: [{ x: 0, z: 0 }], terrain: { minX: 48, minZ: 80, maxX: 64, maxZ: 96 } }] };
    }
    return null;
}) as typeof actionsApi.call;
const { setPlayerPositions } = await import("../../src/lib/players");
setPlayerPositions(new Map([["steve", { x: 56, y: 64, z: 88, dimension: "minecraft:overworld" }]]));

const { default: MapView } = await import("../../src/components/Map");
const root = document.getElementById("app")!;
const dispose = render(() => <PaperProvider><MapView /></PaperProvider>, root);
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
let error = "";
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
} catch (err) {
    error = err instanceof Error ? err.message : String(err);
} finally {
    dispose();
}
document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks: {}, error }))}`;
