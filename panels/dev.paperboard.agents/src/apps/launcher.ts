// What the chat's cards, the Apps page and the app beside the chat share: the
// apps the agent made, read again on each change to them, each one's picture,
// and the one open beside the chat.

import { createEffect, createSignal, on } from "solid-js";
import type { AppInfo } from "../contract";
import type { Agent } from "../lib/agent";

export interface OpenApp {
    name: string;
    title: string;
    url: string;
}

export type Launcher = ReturnType<typeof createLauncher>;

export function createLauncher(agent: Agent) {
    const [list, setList] = createSignal<AppInfo[] | null>(null);
    const [listError, setListError] = createSignal<string | null>(null);
    const [shown, setShown] = createSignal<OpenApp | null>(null);

    const load = () => {
        setListError(null);
        agent.apps().then(
            (apps) => {
                setList(apps);
                // deleted, by the user or the agent: it goes from beside the chat too
                const s = shown();
                if (s && !apps.some((a) => a.name === s.name)) setShown(null);
            },
            (e) => setListError(e instanceof Error ? e.message : String(e)),
        );
    };
    // every change to the apps (a new one, a new picture, a deletion) bumps the revision
    createEffect(on(() => agent.state.apps.revision, load));

    const pictures = new Map<string, Promise<string>>();
    const picture = (name: string) => {
        const key = `${agent.state.apps.revision}\0${name}`;
        let got = pictures.get(key);
        if (!got) {
            got = agent.appPicture(name).then((r) => `data:image/jpeg;base64,${r.image}`);
            // a failure is read again next time, not remembered
            got.catch(() => pictures.delete(key));
            pictures.set(key, got);
        }
        return got;
    };

    return {
        /** the apps, newest first; null until read */
        list,
        listError,
        reload: load,
        revision: () => agent.state.apps.revision,
        /** whether an app is still there: a card for a deleted one says so */
        exists: (name: string) => list()?.some((a) => a.name === name) ?? true,
        picture,
        shown,
        /** open an app beside the chat; fails with the service's reason */
        async open(name: string) {
            const { url, title } = await agent.openApp(name);
            setShown({ name, title, url });
        },
        close: () => setShown(null),
        async remove(name: string) {
            await agent.deleteApp(name);
            if (shown()?.name === name) setShown(null);
            setList((l) => l?.filter((a) => a.name !== name) ?? null);
        },
    };
}
