// network-egress declaration (bun test): the service-side http-get/http-post
// builtins fetch from node, beyond CSP reach — the manifest must declare
// `network: { mode: "any-https" }` and the runtime must enforce it.
import { describe, it, expect } from "bun:test";
import manifest from "../manifest.json";
import { executeFlow } from "../src/lib/runtime";
import { BUILTIN_CATEGORIES } from "../src/lib/builtins";

const schemaFor = (id: string): any => {
    for (const cat of BUILTIN_CATEGORIES as any[]) {
        for (const item of cat.items || []) {
            if (item.action === id || item.trigger === id) return item.schema;
        }
    }
    throw new Error(`no schema for ${id}`);
};

describe("service-side egress is declared and enforced", () => {
    it("manifest declares network any-https for the http builtins", () => {
        expect((manifest as any)?.network?.mode).toBe("any-https");
        // the builtins that need it actually exist
        expect(schemaFor("http-get").id).toBe("http-get");
        expect(schemaFor("http-post").id).toBe("http-post");
    });

    it("http-get refuses plain http to non-loopback hosts", async () => {
        const block = {
            id: "trig",
            panelId: "builtin.logic",
            pos: { x: 0, y: 0 },
            isTrigger: true,
            action: { id: "chat-message", name: "x", output: { type: "object", label: "Message" } },
            values: {},
            children: [
                {
                    id: "b1_http-get",
                    panelId: "builtin.logic",
                    pos: { x: 0, y: 0 },
                    isTrigger: false,
                    action: schemaFor("http-get"),
                    values: { url: "http://example.com/data" },
                },
            ],
        };
        const log = await executeFlow(block as any, {});
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/loopback/);
    });
});
