// secrets channel binding tests (bun test): route table → WS action + unwrap
import { describe, test, expect } from "bun:test";
import { RPC_ROUTES as WS_INVOKE } from "../src/ipc";

const RESULT = {
    "secrets-set": { success: true },
    "secrets-get": { found: true, value: "tok" },
    "secrets-delete": { deleted: true },
    "secrets-list": { keys: ["dev.a/tok"] },
    "secrets-purge": { purged: 1 },
};

const unwrap = (route: { unwrap?: (r: any) => any }, result: any) =>
    route.unwrap ? route.unwrap(result) : result;

describe("secrets route bindings", () => {
    test("every secrets channel maps to the secrets:* action", () => {
        for (const channel of ["secrets-set", "secrets-get", "secrets-delete", "secrets-list", "secrets-purge"]) {
            expect(WS_INVOKE[channel]?.action.startsWith("secrets:")).toBe(true);
        }
    });

    test("unwrap results carry the documented shapes", () => {
        expect(unwrap(WS_INVOKE["secrets-set"], RESULT["secrets-set"])).toBe(true);
        expect(unwrap(WS_INVOKE["secrets-get"], RESULT["secrets-get"])).toEqual({
            found: true,
            value: "tok",
        });
        expect(unwrap(WS_INVOKE["secrets-delete"], RESULT["secrets-delete"])).toBe(true);
        expect(unwrap(WS_INVOKE["secrets-list"], RESULT["secrets-list"])).toEqual(["dev.a/tok"]);
        expect(unwrap(WS_INVOKE["secrets-purge"], RESULT["secrets-purge"])).toBe(1);
    });

    test("get unwrap normalizes missing fields defensively", () => {
        expect(unwrap(WS_INVOKE["secrets-get"], undefined)).toEqual({ found: false, value: null });
        expect(unwrap(WS_INVOKE["secrets-get"], { found: false })).toEqual({
            found: false,
            value: null,
        });
    });
});
