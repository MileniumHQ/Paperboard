// A Discord on loopback: the slice of Discord's REST API (v10, JSON) and
// gateway (JSON encoding, no compression) that the panel's bots use, served
// by one Bun server. discord.js talks to it unmodified once its REST base
// points here (`rest.api`, or BOTCREATOR_DISCORD_API for the service); the
// gateway address comes from GET /gateway/bot, as from Discord.
//
// Each bot is a token Discord knows, with its application, user and guilds.
// Every REST request is recorded, so a test asserts what reached Discord
// (and what never did); the test drives the gateway: dispatching events,
// closing a session with a close code.
import * as crypto from "node:crypto";

const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const DISCORD_EPOCH = 1420070400000n;
const WAIT_MS = 20_000;

let increment = 0n;
/** a snowflake for now, as Discord makes them */
export function snowflake(at = Date.now()): string {
    increment = (increment + 1n) % 4096n;
    return String(((BigInt(at) - DISCORD_EPOCH) << 22n) | increment);
}

export interface FakeChannel {
    id: string;
    name: string;
}

export interface FakeGuild {
    id: string;
    name: string;
    channels: FakeChannel[];
}

export interface FakeBot {
    token: string;
    appId: string;
    username: string;
    guilds: FakeGuild[];
    /** how GET /gateway/bot answers: "ok", or a global rate limit that never lifts in a test */
    gateway: "ok" | "rate-limited";
}

export interface RecordedRequest {
    method: string;
    path: string;
    query: URLSearchParams;
    /** the bot whose token authorized it; null for unauthenticated calls (interaction callbacks, webhooks) */
    bot: string | null;
    body: any;
    /** uploaded files of a multipart request, by field name */
    files: { name: string; bytes: Uint8Array }[];
}

interface GatewaySession {
    ws: Bun.ServerWebSocket<{ token: string | null }>;
    seq: number;
}

export interface FakeDiscord {
    /** the REST base for discord.js (`rest.api`) */
    api: string;
    requests: RecordedRequest[];
    /** a token Discord accepts, for a new application with its own bot user */
    addBot(options?: { username?: string; guilds?: FakeGuild[]; gateway?: FakeBot["gateway"] }): FakeBot;
    /** resolves with the first recorded request (already made or still to come) that `match` accepts */
    request(match: (req: RecordedRequest) => boolean, what: string): Promise<RecordedRequest>;
    /** sends a dispatch event on the bot's live gateway session */
    dispatch(bot: FakeBot, event: string, data: unknown): void;
    /** closes the bot's live gateway session with a close code */
    closeSession(bot: FakeBot, code: number, reason: string): void;
    /** resolves once the bot has a live, identified gateway session */
    sessionOpen(bot: FakeBot): Promise<void>;
    user(bot: FakeBot): Record<string, unknown>;
    stop(): void;
}

function tokenFor(appId: string): string {
    return `${Buffer.from(appId).toString("base64url")}.${crypto.randomBytes(4).toString("base64url")}.${crypto.randomBytes(20).toString("base64url")}`;
}

export function startFakeDiscord(): FakeDiscord {
    const bots = new Map<string, FakeBot>();
    const sessions = new Map<string, GatewaySession>();
    const requests: RecordedRequest[] = [];
    const requestWaiters = new Set<() => void>();
    const sessionWaiters = new Set<() => void>();
    const commandsByScope = new Map<string, unknown[]>();
    let port = 0;

    const userOf = (bot: FakeBot) => ({ id: bot.appId, username: bot.username, discriminator: "0", global_name: null, avatar: null, bot: true });
    const botByAuth = (req: Request): FakeBot | null => {
        const header = req.headers.get("authorization") ?? "";
        return header.startsWith("Bot ") ? bots.get(header.slice(4)) ?? null : null;
    };
    const channelById = (id: string): { channel: FakeChannel; guild: FakeGuild } | null => {
        for (const bot of bots.values()) {
            for (const guild of bot.guilds) {
                const channel = guild.channels.find((c) => c.id === id);
                if (channel) return { channel, guild };
            }
        }
        return null;
    };
    const channelPayload = (channel: FakeChannel, guild: FakeGuild) => ({
        id: channel.id,
        type: 0,
        guild_id: guild.id,
        name: channel.name,
        position: 0,
        permission_overwrites: [],
        parent_id: null,
        nsfw: false,
    });
    const messagePayload = (author: Record<string, unknown>, channelId: string, body: any, attachments: { name: string; bytes: Uint8Array }[] = []) => ({
        id: snowflake(),
        channel_id: channelId,
        author,
        content: typeof body?.content === "string" ? body.content : "",
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: attachments.map((file) => ({ id: snowflake(), filename: file.name, size: file.bytes.length, url: `http://127.0.0.1:${port}/attachments/${file.name}`, proxy_url: `http://127.0.0.1:${port}/attachments/${file.name}` })),
        embeds: Array.isArray(body?.embeds) ? body.embeds : [],
        components: Array.isArray(body?.components) ? body.components : [],
        pinned: false,
        type: 0,
        flags: typeof body?.flags === "number" ? body.flags : 0,
    });
    const guildCreate = (guild: FakeGuild, bot: FakeBot) => ({
        id: guild.id,
        name: guild.name,
        icon: null,
        owner_id: bot.appId,
        unavailable: false,
        member_count: 1,
        large: false,
        joined_at: new Date().toISOString(),
        features: [],
        roles: [{ id: guild.id, name: "@everyone", color: 0, hoist: false, position: 0, permissions: "2147483647", managed: false, mentionable: false, flags: 0 }],
        channels: guild.channels.map((channel) => channelPayload(channel, guild)),
        members: [{ user: userOf(bot), roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, flags: 0 }],
        threads: [],
        presences: [],
        voice_states: [],
        emojis: [],
        stickers: [],
        stage_instances: [],
        guild_scheduled_events: [],
        soundboard_sounds: [],
    });
    const send = (session: GatewaySession, payload: Record<string, unknown>) => session.ws.send(JSON.stringify(payload));
    const sendDispatch = (session: GatewaySession, t: string, d: unknown) => send(session, { op: 0, s: ++session.seq, t, d });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

    async function readBody(req: Request): Promise<{ body: any; files: RecordedRequest["files"] }> {
        const type = req.headers.get("content-type") ?? "";
        if (type.startsWith("multipart/form-data")) {
            const form = await req.formData();
            const files: RecordedRequest["files"] = [];
            let body: any = null;
            for (const [field, value] of form.entries() as Iterable<[string, string | File]>) {
                if (field === "payload_json") body = JSON.parse(String(value));
                else if (typeof value !== "string") files.push({ name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
            }
            return { body, files };
        }
        const text = await req.text();
        return { body: text ? JSON.parse(text) : null, files: [] };
    }

    function route(req: Request, recorded: RecordedRequest, bot: FakeBot | null): Response {
        const { method, path } = recorded;
        const parts = path.split("/").filter(Boolean);
        const unauthorized = () => json(401, { message: "401: Unauthorized", code: 0 });
        if (method === "GET" && path === "/gateway/bot") {
            if (!bot) return unauthorized();
            if (bot.gateway === "rate-limited") {
                return json(429, { message: "You are being rate limited.", retry_after: 3600, global: true }, { "retry-after": "3600", "x-ratelimit-global": "true", "x-ratelimit-scope": "global" });
            }
            return json(200, { url: `ws://127.0.0.1:${port}`, shards: 1, session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 } });
        }
        // PUT /applications/:app/commands, PUT /applications/:app/guilds/:guild/commands
        if (method === "PUT" && parts[0] === "applications" && parts.at(-1) === "commands") {
            if (!bot || bot.appId !== parts[1]) return unauthorized();
            const guildId = parts[2] === "guilds" ? parts[3] : null;
            if (guildId && !bot.guilds.some((g) => g.id === guildId)) return json(403, { message: "Missing Access", code: 50001 });
            const list = (recorded.body as any[]).map((command) => ({
                id: snowflake(),
                application_id: bot.appId,
                version: snowflake(),
                default_member_permissions: null,
                type: 1,
                options: [],
                ...command,
                ...(guildId ? { guild_id: guildId } : {}),
            }));
            commandsByScope.set(`${bot.appId}:${guildId ?? "global"}`, list);
            return json(200, list);
        }
        // POST /interactions/:id/:token/callback
        if (method === "POST" && parts[0] === "interactions" && parts[3] === "callback") {
            return new Response(null, { status: 204 });
        }
        // webhooks: /webhooks/:app/:token[/messages/:message]
        if (parts[0] === "webhooks") {
            const appBot = [...bots.values()].find((b) => b.appId === parts[1]);
            if (!appBot) return json(404, { message: "Unknown Webhook", code: 10015 });
            if (method === "POST" && parts.length === 3) return json(200, messagePayload(userOf(appBot), "0", recorded.body));
            if (parts[3] === "messages" && (method === "GET" || method === "PATCH")) {
                return json(200, { ...messagePayload(userOf(appBot), "0", recorded.body), id: parts[4] === "@original" ? snowflake() : parts[4] });
            }
            if (parts[3] === "messages" && method === "DELETE") return new Response(null, { status: 204 });
        }
        if (parts[0] === "channels" && parts[1]) {
            if (!bot) return unauthorized();
            const found = channelById(parts[1]);
            if (!found) return json(404, { message: "Unknown Channel", code: 10003 });
            if (method === "GET" && parts.length === 2) return json(200, channelPayload(found.channel, found.guild));
            if (method === "POST" && parts[2] === "messages") {
                return json(200, { ...messagePayload(userOf(bot), found.channel.id, recorded.body, recorded.files), guild_id: found.guild.id });
            }
        }
        return json(404, { message: `This loopback Discord does not serve ${method} ${path}`, code: 0 });
    }

    const server = Bun.serve<{ token: string | null }>({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req, srv) {
            if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
                if (srv.upgrade(req, { data: { token: null } })) return undefined;
                return new Response("upgrade failed", { status: 400 });
            }
            const url = new URL(req.url);
            if (!url.pathname.startsWith("/api/v10/")) return json(404, { message: "Not Found", code: 0 });
            const bot = botByAuth(req);
            const { body, files } = await readBody(req);
            const recorded: RecordedRequest = { method: req.method, path: decodeURIComponent(url.pathname.slice("/api/v10".length)), query: url.searchParams, bot: bot?.token ?? null, body, files };
            requests.push(recorded);
            for (const wake of [...requestWaiters]) wake();
            return route(req, recorded, bot);
        },
        websocket: {
            open(ws) {
                // HELLO: a long heartbeat interval, each heartbeat acknowledged
                ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }));
            },
            message(ws, raw) {
                const packet = JSON.parse(String(raw));
                if (packet.op === 1) {
                    ws.send(JSON.stringify({ op: 11 }));
                    return;
                }
                if (packet.op !== 2) return;
                const bot = bots.get(packet.d?.token);
                if (!bot) {
                    ws.close(4004, "Authentication failed.");
                    return;
                }
                ws.data.token = bot.token;
                const session: GatewaySession = { ws, seq: 0 };
                sessions.set(bot.token, session);
                sendDispatch(session, "READY", {
                    v: 10,
                    user: userOf(bot),
                    guilds: bot.guilds.map((g) => ({ id: g.id, unavailable: true })),
                    session_id: crypto.randomBytes(16).toString("hex"),
                    resume_gateway_url: `ws://127.0.0.1:${port}`,
                    shard: [0, 1],
                    application: { id: bot.appId, flags: 0 },
                    private_channels: [],
                    relationships: [],
                    user_settings: {},
                    presences: [],
                    guild_join_requests: [],
                    geo_ordered_rtc_regions: [],
                });
                for (const guild of bot.guilds) sendDispatch(session, "GUILD_CREATE", guildCreate(guild, bot));
                for (const wake of [...sessionWaiters]) wake();
            },
            close(ws) {
                const token = ws.data.token;
                if (token && sessions.get(token)?.ws === ws) sessions.delete(token);
            },
        },
    });
    port = server.port!;
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    if (!allowed) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(port);

    const live = (bot: FakeBot): GatewaySession => {
        const session = sessions.get(bot.token);
        if (!session) throw new Error(`${bot.username} has no live gateway session`);
        return session;
    };

    return {
        api: `http://127.0.0.1:${port}/api`,
        requests,
        addBot(options = {}) {
            const appId = snowflake();
            const bot: FakeBot = { token: tokenFor(appId), appId, username: options.username ?? `bot-${appId.slice(-4)}`, guilds: options.guilds ?? [], gateway: options.gateway ?? "ok" };
            bots.set(bot.token, bot);
            return bot;
        },
        request: (match, what) =>
            new Promise((resolve, reject) => {
                const wake = () => {
                    const found = requests.find(match);
                    if (!found) return;
                    requestWaiters.delete(wake);
                    clearTimeout(timer);
                    resolve(found);
                };
                const timer = setTimeout(() => {
                    requestWaiters.delete(wake);
                    reject(new Error(`Timed out waiting for Discord to receive ${what}; it received:\n${requests.map((r) => `${r.method} ${r.path}`).join("\n")}`));
                }, WAIT_MS);
                requestWaiters.add(wake);
                wake();
            }),
        dispatch: (bot, event, data) => sendDispatch(live(bot), event, data),
        closeSession: (bot, code, reason) => live(bot).ws.close(code, reason),
        sessionOpen: (bot) =>
            new Promise((resolve, reject) => {
                const wake = () => {
                    if (!sessions.has(bot.token)) return;
                    sessionWaiters.delete(wake);
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(() => {
                    sessionWaiters.delete(wake);
                    reject(new Error(`Timed out waiting for ${bot.username} to open a gateway session`));
                }, WAIT_MS);
                sessionWaiters.add(wake);
                wake();
            }),
        user: userOf,
        stop() {
            allowed.delete(port);
            server.stop(true);
        },
    };
}

/** A slash command used in a guild channel, as Discord sends INTERACTION_CREATE. */
export function slashCommand(bot: FakeBot, options: { guild: FakeGuild; name: string; options?: { name: string; type: number; value: unknown }[]; user?: { id: string; username: string } }) {
    const id = snowflake();
    const user = options.user ?? { id: snowflake(), username: "someone" };
    const channel = options.guild.channels[0];
    return {
        id,
        application_id: bot.appId,
        type: 2,
        token: `interaction-token-${id}`,
        version: 1,
        guild_id: options.guild.id,
        channel_id: channel.id,
        channel: { id: channel.id, type: 0, guild_id: options.guild.id, name: channel.name },
        member: { user: { ...user, discriminator: "0", global_name: null, avatar: null }, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, permissions: "2147483647", flags: 0 },
        data: { id: snowflake(), name: options.name, type: 1, guild_id: options.guild.id, options: options.options ?? [] },
        app_permissions: "2147483647",
        locale: "en-US",
        guild_locale: "en-US",
        entitlements: [],
        authorizing_integration_owners: { "0": options.guild.id },
        context: 0,
        attachment_size_limit: 8388608,
    };
}

/** A click on a button of one of the bot's messages, as Discord sends INTERACTION_CREATE. */
export function buttonClick(bot: FakeBot, options: { guild: FakeGuild; customId: string }) {
    const id = snowflake();
    const channel = options.guild.channels[0];
    const user = { id: snowflake(), username: "clicker", discriminator: "0", global_name: null, avatar: null };
    return {
        id,
        application_id: bot.appId,
        type: 3,
        token: `interaction-token-${id}`,
        version: 1,
        guild_id: options.guild.id,
        channel_id: channel.id,
        channel: { id: channel.id, type: 0, guild_id: options.guild.id, name: channel.name },
        member: { user, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, permissions: "2147483647", flags: 0 },
        message: {
            id: snowflake(),
            channel_id: channel.id,
            author: { id: bot.appId, username: bot.username, discriminator: "0", global_name: null, avatar: null, bot: true },
            content: "Pick one",
            timestamp: new Date().toISOString(),
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            components: [{ type: 1, components: [{ type: 2, style: 1, label: "Go", custom_id: options.customId }] }],
            pinned: false,
            type: 0,
            flags: 0,
        },
        data: { custom_id: options.customId, component_type: 2 },
        app_permissions: "2147483647",
        locale: "en-US",
        guild_locale: "en-US",
        entitlements: [],
        authorizing_integration_owners: { "0": options.guild.id },
        context: 0,
        attachment_size_limit: 8388608,
    };
}

/** A message someone posted in a guild channel, as Discord sends MESSAGE_CREATE. */
export function userMessage(guild: FakeGuild, content: string) {
    const channel = guild.channels[0];
    return {
        id: snowflake(),
        channel_id: channel.id,
        guild_id: guild.id,
        author: { id: snowflake(), username: "someone", discriminator: "0", global_name: null, avatar: null },
        member: { roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, flags: 0 },
        content,
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        components: [],
        pinned: false,
        type: 0,
        flags: 0,
    };
}

export function guild(name: string): FakeGuild {
    return { id: snowflake(), name, channels: [{ id: snowflake(), name: "general" }] };
}
