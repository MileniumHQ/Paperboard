import assert from "node:assert/strict";
import type { ActionInfo } from "../../../packages/paperapi/src/index";
import { BUILTIN_DEFS } from "../../../panels/dev.paperboard.actions/src/lib/builtin";
import { isCanvasBlock, type CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";
import { isTypedOnlyInput } from "../../../panels/dev.paperboard.actions/src/lib/inputTypes";

const GAME = "dev.paperboard.gameserver", BOT = "dev.paperboard.botcreator", AI = "dev.paperboard.ai";
export const demoChannel = "124800000000000010";
export const demoUser = "124800000000000020";
export const demoInteraction = "124800000000000030";
export const demoMessage = "124800000000000040";

/** Screenshot documents use the same owners and schemas as library drags. */
export function buildMarketingFlows(registry: ActionInfo[], icons: Record<string, string>) {
    const block = (id: string, owner: string, action: string, values: Record<string, unknown> = {}, children?: CanvasBlock[]): CanvasBlock => {
        const record = owner === "builtin.logic"
            ? BUILTIN_DEFS.find(def => def.id === action)?.item
            : registry.find(item => item.panelId === owner && item.action === action);
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
    const ask = (id: string, prompt: string, model = "") => block(id, AI, "ask", { prompt, model, personality: "no-nonsense" });
    const truncate = (id: string, source: CanvasBlock, length: number) => block(id, "builtin.logic", "text-truncate", { text: ref(source), length, ellipsis: "..." });
    const channel = (id: string) => block(id, BOT, "get-channel", { channelId: demoChannel });
    const send = (id: string, target: CanvasBlock, content: string, extra = {}) => block(id, BOT, "send-message", { channel: ref(target), content, ...extra });

    const count = block("startup-count", GAME, "player-count");
    const startup = block("startup", GAME, "server-started", {}, [count,
        block("startup-announcement", "builtin.logic", "text", { value: `Minecraft is ready at play.example.com. ${ref(count)} players online.` }),
    ]);
    const startupChannel = channel("startup-channel");
    startup.children!.push(startupChannel, send("startup-discord", startupChannel, ref(startup.children![1])));

    const greeting = ask("join-greeting", "Welcome {{player:Username:person}} to our Minecraft world. Mention the town at spawn. One short sentence.");
    const shortGreeting = truncate("join-short", greeting, 160);
    const joinChannel = channel("join-channel");
    const joined = block("player-welcome", GAME, "player-joined", { player: "" }, [greeting, shortGreeting,
        block("join-chat", GAME, "say-chat", { message: ref(shortGreeting) }),
        joinChannel, send("join-discord", joinChannel, "{{player:Username:person}} joined Minecraft. Meet them at spawn!"),
    ]);

    const buttonCount = block("button-count", GAME, "player-count");
    const players = block("button-players", GAME, "list-players");
    const button = block("server-button", BOT, "interaction-triggered", { customId: "minecraft-status" }, [
        block("button-defer", BOT, "defer-interaction", { interactionId: "{{interactionId:Interaction:reply}}", ephemeral: true }),
        buttonCount, players,
        block("button-reply", BOT, "respond-to-interaction", {
            interactionId: "{{interactionId:Interaction:reply}}", ephemeral: true,
            content: `${ref(buttonCount)} players online. ${ref(players)} Join play.example.com.`,
        }),
    ]);

    const welcome = ask("member-welcome", "Write a friendly two-sentence welcome for {{username:Username:person}}. Our Minecraft address is play.example.com. Mention the rules channel.");
    const shortWelcome = truncate("member-short", welcome, 600);
    const newUser = block("member-user", BOT, "get-user", { userId: "{{userId:User:person}}" });
    const welcomeChannel = channel("member-welcome-channel");
    const member = block("member-joined", BOT, "on-member-join", {}, [newUser, welcome, shortWelcome,
        block("member-dm", BOT, "send-dm", { user: ref(newUser), content: ref(shortWelcome) }),
        welcomeChannel, send("member-channel", welcomeChannel, "Welcome <@{{userId:User:person}}>! {{username:Username:person}} just joined our community."),
    ]);

    const smokeAnswer = ask("model-test", "Give one practical Minecraft building tip in one sentence.", "{{string:Model:download_done}}");
    const shortTip = truncate("model-tip", smokeAnswer, 400);
    const modelChannel = channel("model-channel");
    const model = block("model-downloaded", AI, "model-downloaded", { model: "" }, [smokeAnswer, shortTip, modelChannel,
        send("model-report", modelChannel, `Local model {{string:Model:download_done}} is ready. Test answer: ${ref(shortTip)}`),
    ]);

    const tipAnswer = ask("question-answer", "Answer this Minecraft question briefly: {{content:Message:chat}}");
    const shortAnswer = truncate("question-short", tipAnswer, 1600);
    const question = block("tip-request", BOT, "on-message", {}, [
        block("tip-filter", "builtin.logic", "if", { left: "{{content:Message:chat}}", operator: "starts-with", right: "!tip " }, [
            tipAnswer, shortAnswer,
            block("tip-reply", BOT, "send-message", { channel: "{{channelId:Channel:tag}}", reply: "{{messageId:Message:chat}}", content: ref(shortAnswer) }),
        ]),
    ]);

    const remaining = block("leave-count", GAME, "player-count");
    const emptyChannel = channel("empty-channel");
    const leaving = block("player-left", GAME, "player-left", { player: "" }, [remaining,
        block("last-player", "builtin.logic", "if", { left: ref(remaining), operator: "==", right: "0" }, [
            emptyChannel, send("empty-notice", emptyChannel, "{{player:Username:person}} logged off. The Minecraft server is empty; tomorrow's builds are saved."),
        ]),
    ]);
    const statusButton = block("status-button", BOT, "create-button", { label: "Minecraft status", customId: "minecraft-status", style: "primary", disabled: false });
    const botChannel = channel("bot-channel");
    const botReady = block("bot-ready", BOT, "on-bot-ready", {}, [
        botChannel, statusButton,
        send("ready-notice", botChannel, "Check who's playing, or use !tip for a local AI answer.", { components: ref(statusButton) }),
    ]);
    const nightChannel = channel("night-channel");
    const nightCount = block("night-count", GAME, "player-count");
    const nightAnswer = ask("night-copy", `Invite friends to our Minecraft game night at spawn. ${ref(nightCount)} players are online. Mention play.example.com. Two sentences.`);
    const nightShort = truncate("night-short", nightAnswer, 500);
    const nightEmbed = block("night-card", BOT, "create-embed", { title: "Lantern Town game night", description: ref(nightShort), color: "Blue" });
    const nightButton = block("night-button", BOT, "create-button", { label: "Who's playing?", customId: "minecraft-status", style: "primary", disabled: false });
    const nightPost = send("night-post", nightChannel, "Tonight's Minecraft plans", { embeds: ref(nightEmbed), components: ref(nightButton) });
    const gameNight = block("game-night", "builtin.logic", "on-play", {}, [
        nightChannel, nightCount, nightAnswer, nightShort, nightEmbed, nightButton, nightPost,
        block("night-pin", BOT, "pin-message", { channel: ref(nightChannel), message: ref(nightPost) }),
    ]);

    const helpUser = block("guide-user", BOT, "get-user", { userId: "{{authorId:User:person}}" });
    const guideAnswer = ask("guide-answer", "Explain this Minecraft question in three clear steps: {{content:Message:chat}}");
    const guideShort = truncate("guide-short", guideAnswer, 600);
    const helpDesk = block("guide-request", BOT, "on-message", {}, [
        block("guide-filter", "builtin.logic", "if", { left: "{{content:Message:chat}}", operator: "starts-with", right: "!guide " }, [
            helpUser, guideAnswer, guideShort,
            block("guide-dm", BOT, "send-dm", { user: ref(helpUser), content: ref(guideShort) }),
            block("guide-acknowledge", BOT, "send-message", { channel: "{{channelId:Channel:tag}}", reply: "{{messageId:Message:chat}}", content: "Your step-by-step guide is in your DMs." }),
            block("guide-reaction", BOT, "add-reaction", { channel: "{{channelId:Channel:tag}}", message: "{{messageId:Message:chat}}", emoji: "✅" }),
        ]),
    ]);
    return { startup, joined, button, member, model, question, leaving, botReady, gameNight, helpDesk };
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
