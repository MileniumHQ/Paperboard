import { type Accessor, batch, createSignal, onCleanup } from "solid-js";
import { config } from "@mileniumhq/paperapi";
import { logToMain } from "../../lib/shell";
import {
    HOME_LAYOUT_COMPUTER,
    HOME_LAYOUT_ID,
    HOME_PHONE_LAYOUT_ID,
    parseHomeLayout,
    parsePhoneLayout,
    serializeHomeLayout,
    type HomeItem,
} from "../../lib/homeLayout";
import { defaultHomeItems } from "./builtins";
import { errorMessage } from "../../lib/errorMessage";

const SAVE_DEBOUNCE_MS = 250;

export type HomeLoadState = "loading" | "ready" | { error: string };

export interface HomePersistence {
    /** what Home shows */
    items: Accessor<HomeItem[]>;
    loadState: Accessor<HomeLoadState>;
    /** why the last save failed, until a save goes through */
    saveError: Accessor<string | null>;
    /**
     * A phone Home never arranged follows the window's layout ("default":
     * the window's Home was never arranged either), laid out by the caller
     * with show(); null once it is arranged.
     */
    unarranged: Accessor<HomeItem[] | "default" | null>;
    /** shows a layout that is not saved until it is changed */
    show(items: HomeItem[]): void;
    /** shows `next` and saves it, a moment later, after the changes that follow it */
    commit(next: HomeItem[]): void;
    load(): Promise<void>;
    /** saves again what failed to save */
    retrySave(): void;
    /** replaces a layout that can't be read with an empty one: only when the person asks */
    startOver(): Promise<void>;
}

// Home's layout lives in the local daemon's shell document: the window's,
// or the phone's (`phone`, fixed for Home's life), its own arrangement. An
// unreadable layout is shown as an error and never saved over by accident:
// nothing is saved until it is read, and only Start over replaces it.
// Saves are debounced and run one at a time, in order; whatever is still
// unsaved when Home goes is saved then.
export function createHomePersistence(phone: Accessor<boolean>): HomePersistence {
    const layoutId = () => (phone() ? HOME_PHONE_LAYOUT_ID : HOME_LAYOUT_ID);
    const [items, setItems] = createSignal<HomeItem[]>([]);
    const [loadState, setLoadState] = createSignal<HomeLoadState>("loading");
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const [unarranged, setUnarranged] = createSignal<HomeItem[] | "default" | null>(null);

    const load = async () => {
        setLoadState("loading");
        try {
            const raw = await config.get(layoutId(), undefined, HOME_LAYOUT_COMPUTER);
            setUnarranged(null);
            if (raw !== null && raw !== undefined) setItems(phone() ? parsePhoneLayout(raw) : parseHomeLayout(raw));
            else if (!phone()) {
                // a Home never arranged starts with this computer at a glance;
                // nothing is saved until it is changed
                setItems(defaultHomeItems(HOME_LAYOUT_COMPUTER));
            } else {
                // a phone never arranged shows the window's Home, laid out on
                // pages as tall as the screen, until it is changed
                const window = await config.get(HOME_LAYOUT_ID, undefined, HOME_LAYOUT_COMPUTER);
                setUnarranged(window === null || window === undefined ? "default" : parseHomeLayout(window));
            }
            setLoadState("ready");
        } catch (err) {
            logToMain("error", "Failed to load the Home layout:", err);
            setLoadState({ error: errorMessage(err) });
        }
    };

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let dirty = false;
    const flush = async () => {
        clearTimeout(saveTimer);
        if (saving || !dirty || loadState() !== "ready") return;
        saving = true;
        dirty = false;
        try {
            await config.set(serializeHomeLayout(items()), layoutId(), undefined, HOME_LAYOUT_COMPUTER);
            setSaveError(null);
        } catch (err) {
            logToMain("error", "Failed to save the Home layout:", err);
            dirty = true;
            setSaveError(errorMessage(err));
        } finally {
            saving = false;
        }
        // a change made while the save was in flight gets its own save
        if (dirty && !saveError()) saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    };

    const commit = (next: HomeItem[]) => {
        batch(() => {
            setUnarranged(null);
            setItems(next);
        });
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    };

    const startOver = async () => {
        try {
            await config.set(serializeHomeLayout([]), layoutId(), undefined, HOME_LAYOUT_COMPUTER);
            batch(() => {
                setUnarranged(null);
                setItems([]);
                setLoadState("ready");
            });
        } catch (err) {
            logToMain("error", "Failed to reset the Home layout:", err);
            setLoadState({ error: errorMessage(err) });
        }
    };

    onCleanup(() => {
        clearTimeout(saveTimer);
        void flush();
    });

    return {
        items,
        loadState,
        saveError,
        unarranged,
        show: setItems,
        commit,
        load,
        retrySave: () => {
            setSaveError(null);
            void flush();
        },
        startOver,
    };
}
