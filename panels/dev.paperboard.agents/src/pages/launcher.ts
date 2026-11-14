// What the chat's cards, the Pages page and the page beside the chat share:
// the pages the agent made, read again on each change to them, each one's
// picture, and the one open beside the chat.

import { createEffect, createSignal, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { PageInfo, PageKind } from "../contract";
import type { Agent } from "../lib/agent";

export interface OpenPage {
    name: string;
    title: string;
    url: string;
    kind: PageKind;
}

export type Launcher = ReturnType<typeof createLauncher>;

export function createLauncher(agent: Agent) {
    // the pages are a store reconciled by name, so a re-read changes what differs and every row stays the row it was
    const [state, setState] = createStore<{ pages: PageInfo[] | null }>({ pages: null });
    const list = () => state.pages;
    const [listError, setListError] = createSignal<string | null>(null);
    const [shown, setShown] = createSignal<OpenPage | null>(null);

    // each page's picture, read once per time it was taken; a newer one replaces the old, and a deleted page's goes
    const pictures = new Map<string, { at: number; image: Promise<string> }>();
    const prune = (pages: PageInfo[]) => {
        for (const name of pictures.keys()) if (!pages.some((p) => p.name === name)) pictures.delete(name);
    };

    // a slow older read never replaces a newer one
    let generation = 0;
    const load = () => {
        const mine = ++generation;
        setListError(null);
        agent.pages().then(
            (pages) => {
                if (mine !== generation) return;
                setState("pages", reconcile(pages, { key: "name" }));
                prune(pages);
                // deleted, by the user or the agent: it goes from beside the chat too
                const s = shown();
                if (s && !pages.some((a) => a.name === s.name)) setShown(null);
            },
            (e) => {
                if (mine === generation) setListError(e instanceof Error ? e.message : String(e));
            },
        );
    };
    // every change to the pages (a new one, a new picture, a deletion) bumps the revision
    createEffect(on(() => agent.state.pages.revision, load));

    const picture = (name: string, at: number) => {
        const kept = pictures.get(name);
        if (kept?.at === at) return kept.image;
        const image = agent.pagePicture(name).then((r) => `data:image/jpeg;base64,${r.image}`);
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
        listError,
        reload: load,
        /** when a page's picture was taken, or undefined while the pages are unread, the page is gone or it has none */
        pictureAt: (name: string) => list()?.find((a) => a.name === name)?.pictureAt || undefined,
        /** whether a page is still there: a card for a deleted one says so */
        exists: (name: string) => list()?.some((a) => a.name === name) ?? true,
        picture,
        shown,
        /** open a page beside the chat; fails with the service's reason */
        async open(name: string) {
            const { url, title, kind } = await agent.openPage(name);
            setShown({ name, title, url, kind });
        },
        close: () => setShown(null),
        async remove(name: string) {
            await agent.deletePage(name);
            if (shown()?.name === name) setShown(null);
            pictures.delete(name);
            if (state.pages) setState("pages", reconcile(state.pages.filter((a) => a.name !== name), { key: "name" }));
        },
        /** the page as a PDF in the agent's browser, saved where the user chooses; the service's copy goes after */
        async savePdf(name: string) {
            return agent.pagePdf(name);
        },
        discardPdf: (file: string) => agent.discardPagePdf(file),
    };
}
