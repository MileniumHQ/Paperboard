// Tab panels must stay mounted while a game's settings change (bun test,
// browser conditions so Solid is reactive).
//
// describe() builds new tab objects on every call and reruns on every
// settings change. Rendering from those objects remounted each tab; the
// Terraria Overview loads config on mount, which changes settings, so it
// remounted forever and filled the transport's 1000-call window.
import { expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, mapArray } from "solid-js";
import { terraria } from "../src/games/terraria/index";
import { tabIds } from "../src/lib/tabIds";

test("a settings change does not remount the tabs of a game", () => {
    createRoot((dispose) => {
        const [settings, setSettings] = createSignal<Record<string, unknown>>({});
        const features = createMemo(() => terraria.describe({ software: "vanilla", version: "1.4.5.8", settings: settings() }));
        let mounts = 0;
        const rows = createMemo(mapArray(tabIds(() => features().tabs), (id) => { mounts++; return id; }));
        rows();
        const first = mounts;
        expect(first).toBe(features().tabs.length);

        setSettings({ maxplayers: 16 });
        setSettings({ maxplayers: 16 });
        rows();
        expect(mounts).toBe(first);
        dispose();
    });
});
