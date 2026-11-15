// What the chat's cards, the Pages page and the page beside the chat share:
// the pages the agent made, read again on each change to them, each one's
// picture, and the one open beside the chat.

import { createEffect, createSignal, on } from "solid-js";
import { createRead } from "@mileniumhq/paperui/headless";
import type { PageKind } from "../contract";
import type { Agent } from "../lib/agent";

export interface OpenPage {
    name: string;
    title: string;
    url: string;
    kind: PageKind;
}

export type Launcher = ReturnType<typeof createLauncher>;

export function createLauncher(agent: Agent) {
    // each page's picture, read once per time it was taken; a newer one replaces the old, and a deleted page's goes
    // (dropped with any answer: an older list missing a page only costs that page one more read)
    const pictures = new Map<string, { at: number; image: Promise<string> }>();
    const read = async () => {
        const pages = await agent.calls.pages();
        for (const name of pictures.keys()) if (!pages.some((p) => p.name === name)) pictures.delete(name);
        return pages;
    };
    // every change to the pages (a new one, a new picture, a deletion) bumps the revision; reconciled by name, so a re-read changes what differs and every row stays the row it was
    const pages = createRead(read, { source: () => agent.state.pages.revision, key: "name" });
    const list = () => pages.value() ?? null;
    const [shown, setShown] = createSignal<OpenPage | null>(null);

    // deleted, by the user or the agent: it goes from beside the chat too
    createEffect(
        on(
            () => list()?.map((p) => p.name),
            (names) => {
                const s = shown();
                if (names && s && !names.includes(s.name)) setShown(null);
            },
        ),
    );

    const picture = (name: string, at: number) => {
        const kept = pictures.get(name);
        if (kept?.at === at) return kept.image;
        const image = agent.calls.pagePicture({ name }).then((r) => `data:image/jpeg;base64,${r.image}`);
        const entry = { at, image };
        // a failure is read again next time, not remembered
        image.catch(() => {
            if (pictures.get(name) === entry) pictures.delete(name);
        });
        pictures.set(name, entry);
        return image;
    };

    return {
        /** the pages, newest first; null until read */
        list,
        listError: pages.error,
        reload: pages.reload,
        /** when a page's picture was taken, or undefined while the pages are unread, the page is gone or it has none */
        pictureAt: (name: string) => list()?.find((a) => a.name === name)?.pictureAt || undefined,
        /** whether a page is still there: a card for a deleted one says so */
        exists: (name: string) => list()?.some((a) => a.name === name) ?? true,
        picture,
        shown,
        /** open a page beside the chat; fails with the service's reason */
        async open(name: string) {
            const { url, title, kind } = await agent.calls.openPage({ name });
            setShown({ name, title, url, kind });
        },
        close: () => setShown(null),
        async remove(name: string) {
            await agent.calls.deletePage({ name });
            if (shown()?.name === name) setShown(null);
            pictures.delete(name);
            pages.set((left) => left?.filter((a) => a.name !== name));
        },
        /** the page as a PDF in the agent's browser, saved where the user chooses; the service's copy goes after */
        async savePdf(name: string) {
            return agent.calls.pagePdf({ name });
        },
        discardPdf: (file: string) => agent.calls.discardPagePdf({ file }),
    };
}
