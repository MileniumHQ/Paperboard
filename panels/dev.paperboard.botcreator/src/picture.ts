// A Discord avatar or server icon on a page. Server members choose their
// own, so a page never loads one by its address: the service fetches it from
// Discord's CDN (discordCdn.ts) and the page shows the bytes it hands over.
import { createStore } from "solid-js/store";
import { serviceApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./bots";
import { errorToMessage } from "./types";

// by address, for every view of the page: a picture is asked for once
const [shown, setShown] = createStore<Record<string, string>>({});
const asked = new Set<string>();

/**
 * The picture at the Discord address `url`, as a data: address; none until
 * the service hands it over, when there is no address, or when it couldn't
 * be fetched (said in the console; the avatar shows its glyph).
 */
export function picture(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    if (!asked.has(url)) {
        asked.add(url);
        serviceApi.call<string>(PANEL_ID, "getPicture", { url }).then(
            (data) => setShown(url, data),
            (err) => {
                // the next time it's shown asks again
                asked.delete(url);
                console.error(`[Bot Creator] the picture at ${url} couldn't be shown:`, errorToMessage(err));
            },
        );
    }
    return shown[url];
}
