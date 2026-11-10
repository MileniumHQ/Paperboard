import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsApi, checkActionInput, defineAction, validateActionDefinition } from "../src/actions";
import { closeTransport } from "../src/ipc";
import { secretsApi } from "../src/secrets";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

setDefaultTimeout(60_000);

const INPUTS = "dev.test.inputs";
let daemon: Daemon;
let panels: PanelProcess[] = [];

beforeAll(async () => {
    daemon = await startDaemon();
    panels = [await daemon.startPanel(INPUTS, "inputs"), await daemon.startPanel("dev.test.alpha", "owner"), await daemon.startPanel("dev.test.beta", "owner")];
});

afterAll(async () => {
    for (const panel of panels) await panel.stop();
    closeTransport();
    await daemon.stop();
});

// the caller is this test process, signed in as the host through the
// handshake the daemon wrote; the action runs in the panel's own process
const call = (action: string, inputs?: unknown) => actionsApi.call(INPUTS, action, inputs);

// A required action input that is empty is refused before `run`.
describe("a required action input that is empty is refused before run", () => {
    test("a missing, empty or all-empty-list required input is refused naming its label, and run never sees it", async () => {
        const before = await call("runs");
        await expect(call("greet", { tags: ["a"] })).rejects.toThrow('"Name" is required');
        await expect(call("greet", { name: "", tags: ["a"] })).rejects.toThrow('"Name" is required');
        await expect(call("greet", { name: "Ada", tags: ["", null] })).rejects.toThrow('"Tags" is required');
        await expect(call("greet", { name: "Ada", tags: [] })).rejects.toThrow('"Tags" is required');
        await expect(call("greet", undefined)).rejects.toThrow('"Name" is required');
        expect(await call("runs")).toBe(before);
    });

    test("an optional input may stay empty and a complete call runs and returns its result", async () => {
        const before = (await call("runs")) as number;
        expect(await call("greet", { name: "Ada", tags: ["x"], nickname: "" })).toBe("Hello, Ada");
        expect(await call("greet", { name: "Grace", tags: ["", "y"] })).toBe("Hello, Grace");
        expect(await call("runs")).toBe(before + 2);
    });
});

// Action schemas and input limits.
describe("action schemas and input limits", () => {
    test("registration sends every custom type the action names, nested field types included, without code", async () => {
        const listed = await actionsApi.list(INPUTS);
        const members = listed.find((a) => a.action === "members");
        expect(members?.schema?.types).toEqual({
            "test.member": { id: "test.member", name: "Member", base: "object", fields: { role: { type: "test.role" } } },
            "test.role": { id: "test.role", name: "Role", base: "string" },
        });
    });

    test("impossible limits and invalid match rules are refused before anything reaches the wire", async () => {
        const base = { name: "X", description: "", run: () => null };
        await expect(
            actionsApi.register(defineAction({ ...base, id: "backwards", inputs: { n: { type: "number", label: "N", min: 5, max: 1 } } }), undefined, "dev.test.unregistered"),
        ).rejects.toThrow('Action "backwards" input "n" declares a min above its max');
        expect(() => validateActionDefinition({ id: "frac", name: "X", description: "", inputs: { s: { type: "string", label: "S", maxLength: 1.5 } } })).toThrow(
            "declares a maxLength that is not a whole number",
        );
        expect(() => validateActionDefinition({ ...base, id: "routed", match: { field: "id", input: "id" }, inputs: { id: { type: "string", label: "ID" } } })).toThrow(
            "declares match rules but is callable",
        );
        expect(() => validateActionDefinition({ id: "event", name: "X", description: "", match: { field: "id", input: "missing" } })).toThrow(
            'declares a match on undeclared input "missing"',
        );
        expect(() => validateActionDefinition({ id: "event", name: "X", description: "", match: { field: " ", input: "id" }, inputs: { id: { type: "string", label: "ID" } } })).toThrow(
            "declares a match rule without a payload field",
        );
        const names = (await actionsApi.list("dev.test.unregistered")).map((a) => a.action);
        expect(names).toEqual([]);
    });

    test("a call that breaks a declared limit is answered with that limit's error and run never sees it", async () => {
        const before = await call("runs");
        await expect(call("limited", { count: 0 })).rejects.toThrow('"Count" must be at least 1');
        await expect(call("limited", { count: 11 })).rejects.toThrow('"Count" must be at most 10');
        await expect(call("limited", { count: 2.5 })).rejects.toThrow('"Count" must be a whole number');
        await expect(call("limited", { count: "many" })).rejects.toThrow('"Count" must be a number');
        await expect(call("limited", { note: "too long" })).rejects.toThrow('"Note" holds at most 5 characters (it has 8)');
        await expect(call("limited", { ids: [1, 2, 3] })).rejects.toThrow('"IDs" holds at most 2 items (it has 3)');
        await expect(call("limited", { ids: [1, -1] })).rejects.toThrow('Item 2 of "IDs" must be at least 0');
        expect(await call("runs")).toBe(before);
        expect(await call("limited", { count: 10, note: "short", ids: [0, 2] })).toBe("ran");
    });

    test("variable values break no limit", () => {
        const isVariable = (v: unknown) => typeof v === "string" && /^\{\{[^}]+\}\}$/.test(v);
        const count = { type: "number", label: "Count", min: 1, max: 10, integer: true };
        expect(checkActionInput(count, "{{x}}", isVariable)).toBeUndefined();
        expect(checkActionInput({ type: "string", label: "Note", maxLength: 2 }, "{{a.long.path}}", isVariable)).toBeUndefined();
        const ids = { type: "list<number>", label: "IDs", maxItems: 1, min: 0 };
        expect(checkActionInput(ids, [5, "{{x}}", "{{y}}"], isVariable)).toBeUndefined();
        expect(checkActionInput(ids, [5, 6, "{{x}}"], isVariable)).toBe('"IDs" holds at most 1 items (it has 2)');
        // without the predicate the same text is a value, and is checked
        expect(checkActionInput(count, "{{x}}")).toBe('"Count" must be a number');
    });
});

// Handlers are owned by the panel that registers them.
describe("handlers are owned by the panel that registers them (through the daemon)", () => {
    test("two panels register the same action name and each call reaches its own panel", async () => {
        expect(await actionsApi.call("dev.test.alpha", "whoami")).toBe("dev.test.alpha");
        expect(await actionsApi.call("dev.test.beta", "whoami")).toBe("dev.test.beta");
    });
});

// Secrets and backup channels reach the right daemon actions with the documented shapes.
describe("secrets reach the real daemon's vault in the documented shapes", () => {
    test("set resolves true, get {found, value}, list the bare names the panel set, purge a count", async () => {
        expect(await secretsApi.set("api-key", "one", "dev.test.vault")).toBe(true);
        expect(await secretsApi.set("refresh-token", "two", "dev.test.vault")).toBe(true);
        expect(await secretsApi.set("api-key", "other panel", "dev.test.neighbour")).toBe(true);
        expect(await secretsApi.get("api-key", "dev.test.vault")).toEqual({ found: true, value: "one" });
        expect(await secretsApi.get("absent", "dev.test.vault")).toEqual({ found: false, value: null });
        expect((await secretsApi.list("dev.test.vault")).sort()).toEqual(["api-key", "refresh-token"]);
        expect(await secretsApi.purge("dev.test.vault")).toBe(2);
        expect(await secretsApi.list("dev.test.vault")).toEqual([]);
        expect(await secretsApi.get("api-key", "dev.test.neighbour")).toEqual({ found: true, value: "other panel" });
    });
});
