import assert from "node:assert/strict";
import type { ActionInfo } from "../../../packages/paperapi/src/index";
import { BUILTIN_DEFS } from "../../../panels/dev.paperboard.actions/src/lib/builtin";
import { isCanvasBlock, type CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";
import { isTypedOnlyInput } from "../../../panels/dev.paperboard.actions/src/lib/inputTypes";

export const GAME = "dev.paperboard.gameserver";
export const AGENTS = "dev.paperboard.agents";

/**
 * The learn pages' cross-panel flows, built from the schemas the install
 * actually registered, as a Library drag would. Game Server's blocks belong
 * to a server (its project), so the install needs exactly one Minecraft
 * server; Agent's blocks are the panel's own.
 */
export function buildMarketingFlows(registry: ActionInfo[], icons: Record<string, string>) {
    const servers = new Set(registry.filter(item => item.panelId === GAME && item.project).map(item => item.project));
    assert.equal(servers.size, 1, "Add exactly one Minecraft server to the temporary install");
    const [server] = servers;
    const block = (id: string, owner: string, action: string, values: Record<string, unknown> = {}, children?: CanvasBlock[]): CanvasBlock => {
        const record = owner === "builtin.logic"
            ? BUILTIN_DEFS.find(def => def.id === action)?.item
            : registry.find(item => item.panelId === owner && item.action === (owner === GAME ? `${server}/${action}` : action));
        assert.ok(record?.schema, `Missing registered action ${owner}:${action}`);
        assert.equal(record.panelId, owner);
        const result: CanvasBlock = { id, panelId: record.panelId, action: record.schema,
            iconSrc: owner.startsWith("builtin.") ? undefined : icons[owner],
            isTrigger: action === "on-play" || Boolean(record.schema.eventOnly),
            pos: { x: 0, y: 0 }, values, ...(children ? { children } : {}) };
        if (!owner.startsWith("builtin.")) assert.ok(result.iconSrc, `Missing ${owner} icon`);
        return result;
    };
    const ref = (source: CanvasBlock) => {
        const output = source.action.output;
        assert.ok(output, `${source.id} has no output`);
        return `{{${source.id}:${typeof output === "string" ? output : output.label || "Result"}:${source.action.icon || "bolt"}}}`;
    };
    const ask = (id: string, question: string) => block(id, AGENTS, "get-answer", { question });
    const truncate = (id: string, source: CanvasBlock, length: number) => block(id, "builtin.logic", "text-truncate", { text: ref(source), length, ellipsis: "..." });

    const greeting = ask("join-greeting", "Welcome {{player:Username:person}} to our Minecraft world. Mention the town at spawn. One short sentence.");
    const shortGreeting = truncate("join-short", greeting, 160);
    const joined = block("player-welcome", GAME, "player-joined", { player: "" }, [greeting, shortGreeting,
        block("join-chat", GAME, "say-chat", { message: ref(shortGreeting) }),
    ]);

    const challenge = ask("build-challenge", "Give our Minecraft server one fun build challenge for today. One sentence.");
    const shortChallenge = truncate("challenge-short", challenge, 160);
    const startup = block("daily-challenge", GAME, "server-started", {}, [challenge, shortChallenge,
        block("challenge-chat", GAME, "say-chat", { message: ref(shortChallenge) }),
    ]);
    return { joined, startup };
}

/** Editorial fixture validation, not a substitute for a service boundary. */
export function validateMarketingFlow(flow: CanvasBlock, { resolved = false } = {}) {
    assert.ok(isCanvasBlock(flow));
    assert.ok(flow.isTrigger, "A screenshot flow needs a trigger");
    const ids = new Set<string>();
    const initial = new Map<string, string>(Object.entries(flow.action.outputFields || {}).map(([key, field]) => [key, field.type]));
    const rootOutput = flow.action.output;
    if (rootOutput && typeof rootOutput !== "string") initial.set(rootOutput.type, rootOutput.type);
    const visit = (item: CanvasBlock, available: Map<string, string>) => {
        assert.ok(!ids.has(item.id), `Duplicate block ${item.id}`); ids.add(item.id);
        if (!item.panelId.startsWith("builtin.")) assert.ok(item.iconSrc, `${item.id} needs its panel icon`);
        assert.ok(item.action.icon, `${item.id} needs its action icon`);
        for (const key of Object.keys(item.values)) assert.ok(item.action.inputs?.[key], `Unknown input ${item.id}.${key}`);
        for (const [key, input] of Object.entries(item.action.inputs || {})) {
            const value = item.values[key] ?? input.default;
            if (input.required && !input.allowEmpty) assert.ok(value !== undefined && value !== "", `${item.id} needs ${key}`);
            if (value === undefined || value === "") continue;
            const tokens = typeof value === "string" ? [...value.matchAll(/\{\{([^}:]+):[^}]+\}\}/g)] : [];
            if (!resolved && !item.isTrigger && isTypedOnlyInput(input)) assert.ok(tokens.length, `${item.id}.${key}: requires a typed block or trigger field`);
            for (const token of tokens) {
                const sourceType = available.get(token[1]);
                assert.ok(sourceType, `${item.id}: unavailable variable ${token[1]}`);
                const text = input.type === "string" || input.type === "select";
                assert.ok(text || input.type === "any" || input.type === sourceType || input.type === `list<${sourceType}>`, `${item.id}.${key}: ${sourceType} cannot supply ${input.type}`);
                if (!text && input.type !== "any") assert.equal(value, token[0], "Typed inputs require a whole variable");
            }
            if (tokens.length) continue;
            if (input.options?.length) assert.ok(input.options.some(option => option.value === value), `${item.id}.${key}: invalid option`);
            if (input.type === "number") assert.ok(typeof value === "number" && Number.isFinite(value), `${item.id}.${key}: number required`);
            else if (input.type === "boolean") assert.equal(typeof value, "boolean", `${item.id}.${key}: boolean required`);
            else if (["discord-channel", "discord-user", "discord-message", "discord-interaction", "discord-role"].includes(input.type)) assert.match(String(value), /^\d{17,20}$/, `${item.id}.${key}: Discord ID required`);
            else if (input.type.startsWith("list<")) assert.ok(Array.isArray(value), `${item.id}.${key}: list required`);
            else if (input.type === "string" || input.type === "player") assert.equal(typeof value, "string");
        }
        if (item.children) sequence(item.children, new Map(available));
        if (item.elseChildren) sequence(item.elseChildren, new Map(available));
    };
    const sequence = (items: CanvasBlock[], available: Map<string, string>) => {
        for (const item of items) {
            assert.ok(!item.isTrigger, "Event-only blocks cannot be nested");
            visit(item, available);
            const output = item.action.output;
            if (output && typeof output !== "string") available.set(item.id, output.type);
        }
    };
    visit(flow, initial);
}
