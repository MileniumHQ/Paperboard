import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { Providers, SERVER_PROCESS_ID } from "../src/service/providers";
import { brainProgram, fakeEnv, fakeLog, packageHost, SLOW, tempDir, TestHost } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

// The OpenCode provider server is private.
describe("OpenCode's provider server", () => {
    test("binds to 127.0.0.1 behind a random 48-hex password, refuses bad provider ids, and posts a key once", async () => {
        const root = tempDir("providers");
        const host = new TestHost(fakeEnv(root));
        const program = brainProgram(root, "opencode");
        let changes = 0;
        const providers = new Providers({
            host: { ...host, packages: packageHost({}) } as never,
            program: () => program,
            env: () => ({}),
            cwd: root,
            onChange: async () => void changes++,
        });
        cleanups.push(async () => {
            await providers.stop();
            await host.close();
            fs.rmSync(root, { recursive: true, force: true });
        });

        // the captured provider list, connected first
        const list = await providers.list();
        const anthropic = list.find((p) => p.id === "anthropic")!;
        expect(anthropic.methods.map((m) => m.kind)).toEqual(["key"]);
        expect(list.map((p) => p.id)).toContain("amazon-bedrock");

        const [start] = host.startedAs(SERVER_PROCESS_ID);
        expect(start!.args.slice(0, 3)).toEqual(["serve", "--hostname", "127.0.0.1"]);
        expect(start!.stdin).toBe(false);
        const password = start!.env!.OPENCODE_SERVER_PASSWORD!;
        expect(password).toMatch(/^[0-9a-f]{48}$/);
        expect(start!.args.join(" ")).not.toContain(password);
        const listening = fakeLog(root).find((e) => e.event === "listening");
        expect(listening.host).toBe("127.0.0.1");

        const requestsBefore = fakeLog(root).filter((e) => e.event === "request").length;
        for (const bad of ["../credential", "anthropic/../../x", "", "a b", 7]) {
            await expect(providers.connectKey(bad, "sk-x", null)).rejects.toThrow("That isn't a provider id.");
            await expect(providers.disconnect(bad)).rejects.toThrow("That isn't a provider id.");
        }
        expect(fakeLog(root).filter((e) => e.event === "request")).toHaveLength(requestsBefore);

        await providers.connectKey("anthropic", "  sk-ant-secret  ", null);
        const requests = fakeLog(root).filter((e) => e.event === "request");
        expect(requests.every((r) => r.authorized)).toBe(true);
        const posted = requests.filter((r) => r.method === "POST");
        expect(posted.map((r) => [r.path, JSON.parse(r.body)])).toEqual([["/api/integration/anthropic/connect/key", { key: "sk-ant-secret", answer: null }]]);
        expect(changes).toBe(1);

        // the key went in the request body only: never in how the server was started
        expect(JSON.stringify(host.started)).not.toContain("sk-ant-secret");
    }, SLOW);
});
