import { expect, test } from "bun:test";
import { crop } from "../scripts/game-art-crop";

test("wide output crops a square source before scaling", async () => {
    // A square must remain square after crossing the real ffmpeg filter boundary.
    const process = Bun.spawn(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=300x300:d=1", "-vf", `drawbox=x=100:y=100:w=100:h=100:color=white:t=fill,${crop(300, 100)},crop=100:100:100:0,scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { stdout: "pipe", stderr: "pipe" });
    const bytes = new Uint8Array(await new Response(process.stdout).arrayBuffer());
    expect(await process.exited).toBe(0);
    expect(bytes[0]).toBeGreaterThan(240);
});
