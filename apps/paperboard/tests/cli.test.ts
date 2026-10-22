import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../papercrane/index";

const base = ["node", "papercrane"];

describe("parseCliArgs", () => {
    it("--no-auth disables authentication (commander negation)", () => {
        expect(parseCliArgs([...base, "--no-auth"]).noAuth).toBe(true);
    });
    it("rejects the misleading --local authentication bypass alias", async () => {
        // The old assertion expected the defect: a locality flag disabled auth.
        const child = Bun.spawn([process.execPath, "-e", 'import { parseCliArgs } from "./papercrane/index"; parseCliArgs(["bun", "papercrane", "--local"]);'], { stdout: "pipe", stderr: "pipe" });
        const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(code).not.toBe(0);
        expect(err).toContain("unknown option '--local'");
    });
    it("auth stays on by default", () => {
        expect(parseCliArgs([...base]).noAuth).toBeUndefined();
    });
    it("parses port/host/headless/start-pairing", () => {
        const o = parseCliArgs([...base, "--port", "51749", "--host", "127.0.0.1", "--headless", "--start-pairing"]);
        expect(o.port).toBe(51749);
        expect(o.host).toBe("127.0.0.1");
        expect(o.headless).toBe(true);
        expect(o.startPairing).toBe(true);
    });

    it("index has no CLI autostart heuristic (entry lives in main.ts)", async () => {
        // pins the split: importing the library must never boot a server.
        // every suite importing papercrane/index would hang on ports if it did
        const src = await Bun.file(
            new URL("../papercrane/index.ts", import.meta.url).pathname,
        ).text();
        expect(src).not.toContain("require.main");
        expect(src).not.toContain('argv[1]?.includes("papercrane")');
        expect(src).not.toContain("skipping CLI autostart");
    });
});
