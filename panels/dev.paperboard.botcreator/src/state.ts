// The bot list as every window sees it: the service's state, kept live
// through the panel bridge, and the changes a person makes to it. Every
// change goes through the service, which saves the list and announces it.
import { createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createPanelBridge, secretsApi } from "@mileniumhq/paperapi";
import { byCreation, createBotId, PANEL_ID, tokenName, type BotSummary, type BotsServiceState } from "./bots";

const DEFAULT_STATE: BotsServiceState = { bots: [], botsError: null, setupGuideSeen: true };

export type BotsState = ReturnType<typeof createBots>;

export function createBots() {
    const bridge = createPanelBridge<BotsServiceState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });
    // reconciled by id, so a bot keeps its object across announcements and
    // its card stays mounted: a remounted switch would skip its slide
    const [state, setState] = createStore<BotsServiceState>(structuredClone(bridge.getState()));
    const apply = (full: BotsServiceState) => setState(reconcile(structuredClone(full), { key: "id" }));
    const [ready, setReady] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const off = bridge.onStateChange((_patch, full) => apply(full));
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const load = async () => {
        setLoadError(null);
        try {
            apply(await bridge.refreshState());
            setReady(true);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };
    void load();

    const call = <T>(name: string, input: Record<string, unknown>) => bridge.call<T>(name, input);

    return {
        state: () => state,
        ready,
        loadError,
        load,
        /** oldest first, the order they were added in */
        list: () => byCreation(state.bots),
        find: (id: string): BotSummary | undefined => state.bots.find((b) => b.id === id),
        /**
         * Adds a bot: the token goes to the vault under the new bot's id, never
         * over the wire, and the service keeps the bot once it logs in.
         */
        add: async (token: string) => {
            const id = createBotId();
            await secretsApi.set(tokenName(id), token, PANEL_ID);
            return call<BotSummary>("addBot", { bot: id });
        },
        /** saves a new token for the same bot, then reconnects it if it is on */
        replaceToken: async (bot: string, token: string) => {
            await secretsApi.set(tokenName(bot), token, PANEL_ID);
            return call<boolean>("replaceToken", { bot });
        },
        /** the setup guide was finished or skipped: it never shows again */
        markSetupGuideSeen: () => call<boolean>("markSetupGuideSeen", {}),
        setEnabled: (bot: string, enabled: boolean) => call<boolean>(enabled ? "connectBot" : "disconnectBot", { bot }),
        remove: (bot: string) => call<{ deleted: string }>("deleteBot", { bot }),
    };
}
