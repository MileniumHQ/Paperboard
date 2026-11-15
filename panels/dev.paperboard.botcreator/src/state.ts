// The bot list as every window sees it: the service's state, kept live
// through the panel's contract, and the changes a person makes to it. Every
// change goes through the service, which saves the list and announces it.
import { createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { secretsApi, errorMessage, serviceClient } from "@mileniumhq/paperapi";
import { byCreation, createBotId, newTokenName, PANEL_ID, tokenName, type BotSummary, type BotsServiceState } from "./bots";
import { botCreatorContract } from "./contract";

export type BotsState = ReturnType<typeof createBots>;

export function createBots() {
    const { calls, state: service } = serviceClient(botCreatorContract);
    // reconciled by id, so a bot keeps its object across announcements and
    // its card stays mounted: a remounted switch would skip its slide
    const [state, setState] = createStore<BotsServiceState>(structuredClone(service.current()));
    const apply = (full: BotsServiceState) => setState(reconcile(structuredClone(full), { key: "id" }));
    const [ready, setReady] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const off = service.subscribe(apply);
    onCleanup(() => {
        off();
        service.dispose();
    });

    const load = async () => {
        setLoadError(null);
        try {
            apply(await service.refresh());
            setReady(true);
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    void load();

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
            return calls.addBot({ bot: id });
        },
        /**
         * Gives the service a new token for the same bot, in the vault beside
         * the saved one: the service replaces the saved token only once
         * Discord takes the new one, then reconnects the bot if it is on.
         */
        replaceToken: async (bot: string, token: string) => {
            await secretsApi.set(newTokenName(bot), token, PANEL_ID);
            return calls.replaceToken({ bot });
        },
        /** the setup guide was finished or skipped: it never shows again */
        markSetupGuideSeen: () => calls.markSetupGuideSeen(),
        setEnabled: (bot: string, enabled: boolean) => (enabled ? calls.connectBot({ bot }) : calls.disconnectBot({ bot })),
        /** `anyway` deletes it even though Discord refused to take its slash commands off */
        remove: (bot: string, anyway = false) => calls.deleteBot({ bot, anyway }),
    };
}
