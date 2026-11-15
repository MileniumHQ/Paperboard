// A Discord avatar or server icon on a page. Server members choose their
// own, so a page never loads one by its address: the service fetches it from
// Discord's CDN (discordCdn.ts) and the page shows the bytes it hands over.
import { createStore } from "solid-js/store";
import { serviceApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./bots";
import { errorToMessage } from "./types";

// by address, for every view of the page: a picture is asked for once
const [shown, setShown] = createStore<Record<string, { data?: string; problem?: string }>>({});
const asked = new Set<string>();

function ask(url: string): void {
    if (asked.has(url)) return;
    asked.add(url);
    serviceApi.call<string>(PANEL_ID, "getPicture", { url }).then(
        (data) => setShown(url, { data }),
        (err) => {
            // the next time it's shown asks again
            asked.delete(url);
            setShown(url, { problem: errorToMessage(err) });
        },
    );
}

/** The picture at the Discord address `url`, as a data: address; none until the service hands it over, or when there is no address. */
export function picture(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    ask(url);
    return shown[url]?.data;
}

/** Why the picture at `url` couldn't be fetched, for its avatar to say; none while it is shown or still on its way. */
export function pictureProblem(url: string | null | undefined): string | undefined {
    const problem = url ? shown[url]?.problem : undefined;
    return problem ? `The picture couldn't be shown: ${problem}` : undefined;
}
