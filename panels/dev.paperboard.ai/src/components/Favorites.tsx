// Favorite models: the heart on a model card, and the Favorites pane that
// lists hearted models from every provider above the providers themselves.

import { createSignal, For, Show } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperMediaCard, PaperMediaCardGroup, PaperText } from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { isFavorite } from "../core/favorites";
import { makerOf } from "../lib/catalog";
import { call, errorText, state } from "../lib/state";
import AgentLogo from "./AgentLogo";
import MakerLogo from "./MakerLogo";
import styles from "./ModelBrowser.module.css";

/** Hearts or un-hearts one model of one connection; failures are reported, never swallowed. */
export function FavoriteToggle(props: { provider: string; model: string; label?: string; onError: (message: string) => void }) {
    const [busy, setBusy] = createSignal(false);
    const on = () => isFavorite(state.favorites, props.provider, props.model);
    const toggle = async () => {
        setBusy(true);
        try {
            await call(UI_ACTION_IDS.setFavorite, { provider: props.provider, model: props.model, favorite: !on() });
        } catch (err) {
            props.onError(errorText(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperButton
            icon
            size="tiny"
            variant="text"
            aria-label={`Favorite ${props.label ?? props.model}`}
            aria-pressed={on()}
            disabled={busy()}
            class={on() ? styles.favoriteOn : styles.favoriteOff}
            onClick={() => void toggle()}
        >
            favorite
        </PaperButton>
    );
}

/** Every hearted model, across providers; picking one uses it for the chat. */
export function FavoritesPane(props: { onPick: (ref: string, provider: string) => void }) {
    const [error, setError] = createSignal("");
    return (
        <section class={styles.ModelBrowser} aria-label="Favorites">
            <PaperText preset="subtitle">Favorites</PaperText>
            <Show when={error()}>
                <div class={styles.error} role="alert">
                    <PaperText size={2} color="danger">{error()}</PaperText>
                    <PaperButton icon size="tiny" variant="text" aria-label="Dismiss error" onClick={() => setError("")}>close</PaperButton>
                </div>
            </Show>
            <Show
                when={state.favorites.length > 0}
                fallback={
                    <PaperEmptyState
                        icon="favorite"
                        title="No favorites yet"
                        description="Heart a model under any provider to keep it here. Favorites are also the models Paperboard actions and widgets can use."
                    />
                }
            >
                <PaperMediaCardGroup>
                    <For each={state.favorites}>
                        {(f) => {
                            const listed = () => state.models.find((m) => m.provider === f.provider && m.name === f.model);
                            const connection = () => state.connections.find((c) => c.id === f.provider);
                            const name = () => listed()?.label ?? f.model;
                            return (
                                <PaperMediaCard
                                    icon={
                                        connection()?.kind === "agent" ? (
                                            <AgentLogo agent={connection()!.agent} size="large" />
                                        ) : connection()?.kind === "openai-compatible" ? (
                                            <PaperIcon>cloud</PaperIcon>
                                        ) : (
                                            <MakerLogo icon={makerOf(f.model)?.icon} size="large" />
                                        )
                                    }
                                    title={name()}
                                    subtitle={connection()?.label ?? f.provider}
                                    description={listed() ? undefined : `${connection()?.label ?? "Its provider"} doesn't list this model right now.`}
                                    footerRight={
                                        <span class={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                                            <FavoriteToggle provider={f.provider} model={f.model} label={name()} onError={setError} />
                                        </span>
                                    }
                                    onClick={() => {
                                        if (listed()) props.onPick(f.model, f.provider);
                                        else setError(`${name()} isn't available. Open its provider to see why.`);
                                    }}
                                />
                            );
                        }}
                    </For>
                </PaperMediaCardGroup>
            </Show>
        </section>
    );
}
