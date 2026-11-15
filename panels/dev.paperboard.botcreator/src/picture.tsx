// A Discord avatar or server icon on a page. Server members choose their
// own, so a page never loads one by its address: the service fetches it from
// Discord's CDN (discordCdn.ts) and the page shows the bytes it hands over.
import { createStore } from "solid-js/store";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import { serviceApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./bots";
import { errorToMessage } from "./types";

// by address, for every view of the page: each is asked for once, and its
// one answer (the picture, or why there is none) stands until the page
// opens again
const [shown, setShown] = createStore<Record<string, { data?: string; problem?: string }>>({});
const asked = new Set<string>();

function ask(url: string): void {
    if (asked.has(url)) return;
    asked.add(url);
    serviceApi.call<string>(PANEL_ID, "getPicture", { url }).then(
        (data) => setShown(url, { data }),
        (err) => setShown(url, { problem: `The picture couldn't be shown: ${errorToMessage(err)}` }),
    );
}

/** The picture at the Discord address `url`, as a data: address; none until the service hands it over, or when there is no address. */
export function picture(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    ask(url);
    return shown[url]?.data;
}

/** A card's icon for the picture at `url`: the picture, `glyph` while there is none, and a broken picture when it couldn't be fetched. */
export function pictureIcon(url: string | null | undefined, glyph: string): string {
    return picture(url) ?? (url && shown[url]?.problem ? "broken_image" : glyph);
}

/** The picture at `url` as an avatar, which says why when it couldn't be fetched. */
export function DiscordAvatar(props: { url: string | null | undefined; fallbackIcon: string; size?: PaperAvatarSize; alt?: string }) {
    const problem = () => (props.url ? shown[props.url]?.problem : undefined);
    return (
        <PaperAvatar
            src={picture(props.url)}
            title={problem()}
            accent={problem() ? "danger" : undefined}
            fallbackIcon={props.fallbackIcon}
            size={props.size}
            alt={props.alt}
        />
    );
}
