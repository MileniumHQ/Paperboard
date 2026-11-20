// Steam players' profile pictures as a Players page has them. The service
// fetches each (service/steamAvatars.ts) and the page gets the picture
// itself, never an address. Each account is asked for once however many rows
// and panes show it, a few at a time so a roster of hundreds is not hundreds
// of calls at once, and what has come stays while this window is open, so
// going back to the tab paints the pictures at once.
import { createStore, produce } from "solid-js/store";
import { LimitedQueue } from "@mileniumhq/paperapi";
import { panelCalls } from "./api";
import { errorMessage } from "./failure";
import { steamAccount } from "../games/steam/steamAccount";
import type { PlayerPicture } from "../components/PlayerAvatar";

const AT_ONCE = 8;
/** Pictures kept; each is a few kilobytes of data. The oldest go first. */
const MAX_KEPT = 1024;

type Answer = { state: "picture"; src: string } | { state: "none" } | { state: "failed"; error: string };
const [answers, setAnswers] = createStore<Record<string, Answer>>({});
// the accounts asked for, whose answer hasn't come, and the order answers came in
const asked = new Set<string>();
const order: string[] = [];
const line = new LimitedQueue(AT_ONCE);

async function ask(account: string): Promise<void> {
    let answer: Answer;
    try {
        const src = await line.run(() => panelCalls.steamAvatar({ steamId: account }));
        answer = src === null ? { state: "none" } : { state: "picture", src };
    } catch (err) {
        answer = { state: "failed", error: errorMessage(err) };
    }
    asked.delete(account);
    setAnswers(
        produce((all) => {
            if (!(account in all)) order.push(account);
            all[account] = answer;
            while (order.length > MAX_KEPT) delete all[order.shift()!];
        }),
    );
}

/** A player's profile pictures on one page: asked of the service as rows show them, failing out loud. */
export interface SteamPictures {
    /** a player's picture as the page has it; undefined for an id that is no Steam account (a bot), which has none to ask for */
    of(id: string | undefined): PlayerPicture | undefined;
    /** why some pictures are missing, with how many; empty while they load and once all are here */
    failure(): { reason: string; count: number } | null;
    /** asks again for every picture that failed */
    retry(): void;
}

/**
 * The profile pictures of a page's Steam players. A picture that failed is
 * asked for again each time a page is made, and by `retry`.
 */
export function createSteamPictures(): SteamPictures {
    forgetFailures();
    return {
        of: (id) => {
            const account = id === undefined ? null : steamAccount(id);
            if (!account) return undefined;
            const answer = answers[account];
            if (!answer && !asked.has(account)) {
                asked.add(account);
                void ask(account);
            }
            if (!answer) return { state: "loading" };
            if (answer.state === "picture") return { state: "picture", src: answer.src };
            if (answer.state === "none") return { state: "none", why: "Steam has no picture for this account" };
            return { state: "failed", error: answer.error };
        },
        failure: () => {
            const failed = Object.values(answers).filter((answer) => answer.state === "failed");
            return failed.length === 0 ? null : { reason: (failed[0] as { error: string }).error, count: failed.length };
        },
        retry: forgetFailures,
    };
}

/** Failures are dropped: the rows that showed them ask again. */
function forgetFailures(): void {
    setAnswers(
        produce((all) => {
            for (const [account, answer] of Object.entries(all)) {
                if (answer.state !== "failed") continue;
                delete all[account];
                order.splice(order.indexOf(account), 1);
            }
        }),
    );
}
