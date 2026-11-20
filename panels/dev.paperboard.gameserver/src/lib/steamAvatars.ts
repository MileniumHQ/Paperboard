// Steam players' profile pictures as a Players page has them. The service
// fetches each (service/steamAvatars.ts) and the page gets the picture
// itself, never an address. A picture is asked for when its avatar is first
// on screen (PlayerAvatar), not when its row is made: a roster is every
// player a server ever had, and only the rows being looked at are asked for.
// Each is asked for once however many rows and panes show it, a few at a
// time, and what has come stays for as long as this server's page is open,
// so going back to the tab paints the pictures at once and nothing on screen
// is ever dropped to make room.
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { LimitedQueue } from "@mileniumhq/paperapi";
import type { PaperAvatarSize } from "@mileniumhq/paperui";
import { panelCalls } from "./api";
import { errorMessage } from "./failure";
import { useServer, type ServerPage } from "./server";
import { steamAccount } from "../games/steam/steamAccount";
import type { PlayerPicture } from "../components/PlayerAvatar";

const AT_ONCE = 8;
const line = new LimitedQueue(AT_ONCE);

/** A list's rows draw 32 px, which the 64 px picture fills; an avatar of 48 px or more is sharper from the 184 px one. */
type PictureSize = "medium" | "full";
const pictureSize = (size: PaperAvatarSize): PictureSize => (size === "small" || size === "medium" ? "medium" : "full");

type Answer = { state: "picture"; src: string } | { state: "none" } | { state: "failed"; error: string };
// by account and size ("7656119…/medium"); the accounts asked for, whose answer hasn't come, are in `asked`
const kept = new WeakMap<ServerPage, { answers: Record<string, Answer>; setAnswers: SetStoreFunction<Record<string, Answer>>; asked: Set<string> }>();
function keptFor(server: ServerPage) {
    let have = kept.get(server);
    if (!have) {
        const [answers, setAnswers] = createStore<Record<string, Answer>>({});
        have = { answers, setAnswers, asked: new Set() };
        kept.set(server, have);
    }
    return have;
}

/** A player's profile pictures on one page: asked of the service as rows show them, failing out loud. */
export interface SteamPictures {
    /**
     * a player's picture as the page has it, for an avatar of `size`; undefined
     * for an id that is no Steam account (a bot), which has none to ask for.
     * Until it is asked for, the picture is loading, with the `ask` that
     * PlayerAvatar calls once it is on screen.
     */
    of(id: string | undefined, size: PaperAvatarSize): PlayerPicture | undefined;
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
    const { answers, setAnswers, asked } = keptFor(useServer());

    async function ask(key: string, account: string, size: PictureSize): Promise<void> {
        if (key in answers || asked.has(key)) return;
        asked.add(key);
        let answer: Answer;
        try {
            const src = await line.run(() => panelCalls.steamAvatar({ steamId: account, size }));
            answer = src === null ? { state: "none" } : { state: "picture", src };
        } catch (err) {
            answer = { state: "failed", error: errorMessage(err) };
        }
        asked.delete(key);
        setAnswers(key, answer);
    }

    /** Failures are dropped: the rows that showed them ask again. */
    const forgetFailures = () =>
        setAnswers(
            produce((all) => {
                for (const [key, answer] of Object.entries(all)) if (answer.state === "failed") delete all[key];
            }),
        );
    forgetFailures();

    return {
        of: (id, size) => {
            const account = id === undefined ? null : steamAccount(id);
            if (!account) return undefined;
            const wanted = pictureSize(size);
            const key = `${account}/${wanted}`;
            const answer = answers[key];
            if (!answer) return { state: "loading", ask: () => void ask(key, account, wanted) };
            if (answer.state === "picture") return { state: "picture", src: answer.src };
            if (answer.state === "none") return { state: "none", why: "Steam has no picture for this account" };
            return { state: "failed", error: answer.error };
        },
        failure: () => {
            const failed = Object.entries(answers).filter(([, answer]) => answer.state === "failed");
            if (failed.length === 0) return null;
            // an account that failed at both sizes is one missing picture
            return { reason: (failed[0]![1] as { error: string }).error, count: new Set(failed.map(([key]) => key.split("/")[0])).size };
        },
        retry: forgetFailures,
    };
}
