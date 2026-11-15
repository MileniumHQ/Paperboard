// A picture from elsewhere, as the page has it: never its address, which a
// page must not load, but the picture the service fetched (service/pictures.ts)
// as a data: address.
import { createResource } from "solid-js";
import { serversBridge } from "./api";
import { errorMessage } from "./failure";
import { PICTURE_CALL, type PictureSource } from "../service/contract";

const MAX_KEPT = 256;
// by source and address, so a list drawn again paints its pictures at once;
// a failure is not kept, so the next ask tries again
const kept = new Map<string, string>();

/** The picture at `url` from `from`, fetched by the service. */
export async function servedPicture(from: PictureSource, url: string): Promise<string> {
    const key = `${from} ${url}`;
    const have = kept.get(key);
    if (have !== undefined) return have;
    const picture = await serversBridge.call<string>(PICTURE_CALL, { from, url });
    kept.set(key, picture);
    if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
    return picture;
}

/** A picture as a screen shows it: its data: address once here, and why not if it couldn't be. */
export interface ServedPicture {
    src(): string | undefined;
    loading(): boolean;
    /** why there is no picture; null while it loads, once it is here, and when there is none to load */
    error(): string | null;
}

/** The picture at `url()` from `from()`, asked again whenever either changes; no address is no picture. */
export function createServedPicture(from: () => PictureSource, url: () => string | null | undefined): ServedPicture {
    const key = () => (url() ? `${from()} ${url()}` : "");
    const [picture] = createResource(
        () => key() || false,
        async (current) => {
            const address = url()!;
            try {
                return { key: current, src: await servedPicture(from(), address), error: null };
            } catch (err) {
                return { key: current, src: undefined, error: errorMessage(err) };
            }
        },
    );
    // a resource keeps its last value while the next loads: only this picture's is shown
    const current = () => (picture.latest?.key === key() ? picture.latest : undefined);
    return {
        src: () => current()?.src ?? kept.get(key()),
        loading: () => Boolean(url()) && !current(),
        error: () => current()?.error ?? null,
    };
}
