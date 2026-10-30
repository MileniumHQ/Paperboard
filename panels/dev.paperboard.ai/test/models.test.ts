import { describe, expect, it } from "bun:test";
import { ModelManager } from "../src/service/models";
import type { ModelClient } from "../src/service/provider";

const client = (names: string[] | Error): ModelClient => ({
    chat: async () => {},
    tags: async () => {
        if (names instanceof Error) throw names;
        return names.map((name) => ({ name, size: 1 }) as any);
    },
    show: async () => ({ capabilities: ["completion"] }),
});

describe("model listing", () => {
    it("lists every reachable connection and reports a down one as unavailable, not empty", async () => {
        let errors: Record<string, string> = {};
        const manager = new ModelManager({
            clients: () =>
                new Map([
                    ["api-0000000a", client(new Error("connect ECONNREFUSED"))],
                    ["api-0000000b", client(["local:7b"])],
                ]),
            onModels: (_models, e) => {
                errors = e;
            },
            onPulls: () => {},
        });
        const models = await manager.refresh();
        expect(models.map((m) => [m.provider, m.name])).toEqual([["api-0000000b", "local:7b"]]);
        expect(errors).toEqual({ "api-0000000a": "connect ECONNREFUSED" });
        // a name is served by the connection that lists it
        expect(manager.providerOf("local:7b")).toBe("api-0000000b");
        expect(manager.capabilities("local:7b", "api-0000000a")).toBeUndefined();
    });
});
