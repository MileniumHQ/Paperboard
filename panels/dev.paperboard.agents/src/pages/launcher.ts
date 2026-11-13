// What the chat's cards, the Pages page and the page beside the chat share:
// the pages the agent made, read again on each change to them, each one's
// picture, and the one open beside the chat.

import { createEffect, createSignal, on } from "solid-js";
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
    const [list, setList] = createSignal<PageInfo[] | null>(null);
    const [listError, setListError] = createSignal<string | null>(null);
    const [shown, setShown] = createSignal<OpenPage | null>(null);

    const load = () => {
        setListError(null);
        agent.pages().then(
            (pages) => {
                setList(pages);
                // deleted, by the user or the agent: it goes from beside the chat too
                const s = shown();
                if (s && !pages.some((a) => a.name === s.name)) setShown(null);
            },
            (e) => setListError(e instanceof Error ? e.message : String(e)),
        );
    };
    // every change to the pages (a new one, a new picture, a deletion) bumps the revision
    createEffect(on(() => agent.state.pages.revision, load));

    const pictures = new Map<string, Promise<string>>();
    const picture = (name: string) => {
        const key = `${agent.state.pages.revision}\0${name}`;
        let got = pictures.get(key);
        if (!got) {
            got = agent.pagePicture(name).then((r) => `data:image/jpeg;base64,${r.image}`);
            // a failure is read again next time, not remembered
            got.catch(() => pictures.delete(key));
            pictures.set(key, got);
        }
        return got;
    };

    return {
        /** the pages, newest first; null until read */
        list,
        listError,
        reload: load,
        revision: () => agent.state.pages.revision,
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
            setList((l) => l?.filter((a) => a.name !== name) ?? null);
        },
        /** the page as a PDF in the agent's browser, saved where the user chooses; the service's copy goes after */
        async savePdf(name: string) {
            return agent.pagePdf(name);
        },
        discardPdf: (file: string) => agent.discardPagePdf(file),
    };
}
