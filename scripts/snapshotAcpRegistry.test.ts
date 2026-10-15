import { describe, expect, it } from "bun:test";
import { binaryCommand, npmCommand, packageName, snapshotAgent } from "./snapshot-acp-registry";

describe("ACP registry snapshot", () => {
    it("records the command an npm install links, not the package name", () => {
        expect(packageName("@agentclientprotocol/claude-agent-acp@0.90.0")).toBe("@agentclientprotocol/claude-agent-acp");
        expect(npmCommand("@google/gemini-cli", { gemini: "bundle/gemini.js" })).toBe("gemini");
        expect(npmCommand("@tencent-ai/codebuddy-code", { cbc: "a", "codebuddy-code": "a" })).toBe("codebuddy-code");
        const agent = snapshotAgent(
            { id: "gemini", name: "Gemini CLI", distribution: { npx: { package: "@google/gemini-cli@0.64.0", args: ["--acp"] } } },
            new Map([["@google/gemini-cli@0.64.0", { gemini: "bundle/gemini.js" }]]),
        );
        expect(agent).toMatchObject({ command: "gemini", args: ["--acp"], install: { kind: "npm", package: "@google/gemini-cli" } });
    });

    it("keeps a binary only when every platform ships the same plain name", () => {
        expect(binaryCommand({ "linux-x86_64": { cmd: "./goose", args: ["acp"] }, "windows-x86_64": { cmd: "./goose.exe", args: ["acp"] } })).toEqual({
            command: "goose",
            args: ["acp"],
        });
        expect(binaryCommand({ "darwin-aarch64": { cmd: "./pool-darwin-arm64" }, "linux-x86_64": { cmd: "./pool-linux-x64" } })).toBeUndefined();
        expect(binaryCommand({ "linux-x86_64": { cmd: "./agy_acp_server.par" } })).toBeUndefined();
        // nothing to point the user at for an install: left out
        expect(snapshotAgent({ id: "x", name: "X", distribution: { binary: { "linux-x86_64": { cmd: "./x" } } } }, new Map())).toBeUndefined();
    });
});
