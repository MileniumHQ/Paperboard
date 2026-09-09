import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../papercrane/index";

const base = ["node", "papercrane"];

describe("parseCliArgs", () => {
    it("--no-auth disables authentication (commander negation)", () => {
        expect(parseCliArgs([...base, "--no-auth"]).noAuth).toBe(true);
    });
    it("--local disables authentication", () => {
        expect(parseCliArgs([...base, "--local"]).noAuth).toBe(true);
    });
    it("auth stays on by default", () => {
        expect(parseCliArgs([...base]).noAuth).toBeUndefined();
    });
    it("parses port/host/headless/pair", () => {
        const o = parseCliArgs([...base, "--port", "45599", "--host", "127.0.0.1", "--headless", "--pair"]);
        expect(o.port).toBe(45599);
        expect(o.host).toBe("127.0.0.1");
        expect(o.headless).toBe(true);
        expect(o.startPairing).toBe(true);
    });
});
