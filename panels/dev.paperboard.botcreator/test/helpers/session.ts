// One bot's session, built the way the service builds it, with a host that
// records what the session told the service: every trigger it fired and a
// wait on any state it reports. Its Discord client is the production one,
// pointed at the loopback Discord through BOTCREATOR_DISCORD_API.
import { afterAll, beforeAll } from "bun:test";
import { BotSession } from "../../src/session";
import { TEST_TRUSTED_ORIGINS_ENV } from "@mileniumhq/paperapi/net";
import { startFakeDiscord, type FakeDiscord } from "./discord";

const WAIT_MS = 20_000;
// every session this file started; stopped before its loopback Discord goes
const sessions: BotSession[] = [];

/** A loopback Discord for this file, and the service's environment pointed at it. */
export function useFakeDiscord(): () => FakeDiscord {
    let discord: FakeDiscord | null = null;
    const previous: Record<string, string | undefined> = {};
    const names = ["BOTCREATOR_DISCORD_API", TEST_TRUSTED_ORIGINS_ENV];
    beforeAll(() => {
        discord = startFakeDiscord();
        for (const name of names) previous[name] = process.env[name];
        process.env.BOTCREATOR_DISCORD_API = discord.api;
        // its files and pictures are fetched as public ones would be
        process.env[TEST_TRUSTED_ORIGINS_ENV] = new URL(discord.api).origin;
    });
    afterAll(async () => {
        for (const session of sessions.splice(0)) await session.stop();
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
        discord?.stop();
    });
    return () => {
        if (!discord) throw new Error("the loopback Discord starts in beforeAll");
        return discord;
    };
}

export interface RecordedSession {
    session: BotSession;
    triggers: { trigger: string; output: any }[];
    /** what the session told the service went wrong with no button waiting */
    problems: string[];
    /** resolves once `accept` holds, checked now and whenever the session fires a trigger or reports a change */
    until(accept: () => boolean, what: string): Promise<void>;
}

export function recordedSession(id: string): RecordedSession {
    const triggers: RecordedSession["triggers"] = [];
    const problems: string[] = [];
    const waiters = new Set<() => void>();
    const wake = () => {
        for (const waiter of [...waiters]) waiter();
    };
    const session = new BotSession(id, {
        emit(trigger, output) {
            triggers.push({ trigger, output });
            wake();
        },
        // what the bot heard reaches its triggers too (on-message), which this records
        heard: () => {},
        changed: wake,
        problem(text) {
            problems.push(text);
            wake();
        },
    });
    sessions.push(session);
    return {
        session,
        triggers,
        problems,
        until: (accept, what) =>
            new Promise((resolve, reject) => {
                const check = () => {
                    if (!accept()) return;
                    waiters.delete(check);
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(() => {
                    waiters.delete(check);
                    reject(new Error(`Timed out waiting for ${what}; the session is ${JSON.stringify(session.status())}, triggers ${JSON.stringify(triggers.map((t) => t.trigger))}`));
                }, WAIT_MS);
                waiters.add(check);
                check();
            }),
    };
}
