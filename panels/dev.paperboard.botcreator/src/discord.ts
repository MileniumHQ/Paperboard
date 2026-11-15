// Which Discord the bots talk to, and discord.js, loaded the first time
// something needs it. The library and what it brings with it are most of
// this service's memory, and a service with no bot running never touches
// Discord, so nothing here imports it up front: types come from
// `import type`, values from loadDiscord() or discord().
import type { REST } from "discord.js";
import { errorMessage } from "@mileniumhq/paperapi";

type Discord = typeof import("discord.js");

let loading: Promise<Discord> | undefined;
let loaded: Discord | undefined;

/** discord.js, imported once. A failed import rejects here, and the next call tries again. */
export function loadDiscord(): Promise<Discord> {
    loading ??= import("discord.js").then(
        (lib) => (loaded = lib),
        (err) => {
            loading = undefined;
            throw err;
        },
    );
    return loading;
}

/**
 * discord.js for code that cannot wait and already holds something of a
 * bot's: a session loads the library before its client exists, so by then it
 * is here. Anything that can run with no bot started awaits loadDiscord().
 */
export function discord(): Discord {
    if (!loaded) throw new Error("discord.js is not loaded yet: no bot has been started");
    return loaded;
}

/**
 * The Discord API base a bot's client talks to. Unset, it is discord.com.
 * BOTCREATOR_DISCORD_API names another Discord-compatible API (an http or
 * https address ending in /api), which is how the panel's tests run bots
 * against a Discord on loopback; the gateway address comes from that API,
 * and its pictures are at /cdn on the same host (discordCdnBase).
 */
export function discordApiBase(env: Record<string, string | undefined> = process.env): string | undefined {
    const raw = env.BOTCREATOR_DISCORD_API;
    if (raw === undefined || raw === "") return undefined;
    let url: URL;
    try {
        url = new URL(raw);
    } catch (err) {
        throw new Error(`BOTCREATOR_DISCORD_API is not a web address: "${raw}" (${errorMessage(err)})`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`BOTCREATOR_DISCORD_API must be an http or https address, not "${raw}"`);
    }
    return url.href.replace(/\/+$/, "");
}

/** Where a bot's client says avatars and server icons are: Discord's CDN, or /cdn beside BOTCREATOR_DISCORD_API. */
export function discordCdnBase(env: Record<string, string | undefined> = process.env): string {
    const api = discordApiBase(env);
    return api ? `${new URL(api).origin}/cdn` : "https://cdn.discordapp.com";
}

/**
 * The origins a bot's fetches (fetchPublic) may reach on this computer: the
 * Discord BOTCREATOR_DISCORD_API names, which is a test's on loopback. None
 * for Discord itself, whose servers are public.
 */
export function discordOrigins(env: Record<string, string | undefined> = process.env): string[] {
    const api = discordApiBase(env);
    return api ? [new URL(api).origin] : [];
}

/** A REST client for `token` alone, with no gateway login and no sweep timers to outlive its requests. */
export async function tokenRest(token: string): Promise<REST> {
    const { REST } = await loadDiscord();
    const api = discordApiBase();
    return new REST({ ...(api ? { api } : {}), hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(token);
}

/**
 * The Discord user a bot token logs in as, asked over REST with no gateway
 * login, so a bot that is running keeps running while a new token is
 * checked; throws what Discord refused.
 */
export async function tokenUser(token: string): Promise<string> {
    const { Routes } = await loadDiscord();
    const user = (await (await tokenRest(token)).get(Routes.user())) as { id?: unknown };
    if (typeof user?.id !== "string") throw new Error("Discord didn't say which bot the token is for.");
    return user.id;
}
