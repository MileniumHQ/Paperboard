// Painting a map region is seconds of parsing on a small server, inside the
// service's only event loop. These hold the two rules that keep the rest of
// the panel answering while a map loads: a painter gives the loop its turns,
// and regions paint one at a time, each once however many ask.
import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { paintInTurn, paintRegion } from "../src/service/map";

/** a region file holding `count` chunks, each real NBT the painter must parse */
function regionOf(count: number): Buffer {
    const chunk = deflateSync(nbt.writeUncompressed(nbt.comp({ Status: nbt.string("minecraft:full") }) as never));
    const sectors = Math.ceil((chunk.length + 5) / 4096);
    const region = Buffer.alloc(8192 + count * sectors * 4096);
    for (let i = 0; i < count; i++) {
        const sector = 2 + i * sectors;
        region.writeUIntBE(sector, i * 4, 3);
        region[i * 4 + 3] = sectors;
        region.writeUInt32BE(chunk.length + 1, sector * 4096);
        region[sector * 4096 + 4] = 2;
        chunk.copy(region, sector * 4096 + 5);
    }
    return region;
}

describe("painting the map leaves the service answering", () => {
    test("a region being painted gives the event loop a turn before it finishes", async () => {
        // other work waiting on the loop, counted each time it gets to run
        let turns = 0;
        let waiting = true;
        const other = () => { turns++; if (waiting) setImmediate(other); };
        setImmediate(other);
        try {
            let turnsWhenPainted = -1;
            await paintRegion(regionOf(64), 0, "r.0.0.mca").then(() => { turnsWhenPainted = turns; });
            // 64 chunks at 8 a turn: other work ran several times while it painted
            expect(turnsWhenPainted).toBeGreaterThanOrEqual(4);
        } finally {
            waiting = false;
        }
    });

    test("regions paint one at a time, and a region asked for twice paints once", async () => {
        const log: string[] = [];
        const paint = (name: string) => async () => {
            log.push(`${name} starts`);
            await new Promise((resolve) => setTimeout(resolve, 5));
            log.push(`${name} ends`);
            return name;
        };
        const results = await Promise.all([
            paintInTurn("a", paint("a")),
            paintInTurn("b", paint("b")),
            paintInTurn("a", paint("a again")),
        ]);
        expect(results).toEqual(["a", "b", "a"]);
        expect(log).toEqual(["a starts", "a ends", "b starts", "b ends"]);
    });

    test("a region that fails to paint fails its own callers and lets the next one paint", async () => {
        const failed = paintInTurn("bad", async () => { throw new Error("unreadable region"); });
        const next = paintInTurn("good", async () => "painted");
        await expect(failed).rejects.toThrow("unreadable region");
        expect(await next).toBe("painted");
    });
});
