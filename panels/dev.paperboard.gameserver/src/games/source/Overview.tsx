import { createSignal, For, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperFlex, PaperModal, PaperQuote, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverLevel, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { GameDefinition } from "../types";
import { ACTION_IDS as A } from "../../service/contract";
import { mapMode, sourceActions, type SourceGameSpec } from "./index";

export default function SourceOverview(props: { spec: SourceGameSpec; game: GameDefinition }) {
    const ids = sourceActions(props.spec.id);
    const features = props.game.describe({ software: "", version: "" });
    // a running server's own map, which its map cycle changes; the one it starts on otherwise
    const map = () => serverLevel() ?? String(gameSettings().map ?? "");
    const [open, setOpen] = createSignal(false);
    const [maps, setMaps] = createSignal<string[]>([]);
    const [choice, setChoice] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");

    const edit = async () => {
        setChoice(map());
        setError("");
        setOpen(true);
        try { setMaps(await serverBridge.call<string[]>(ids.maps)); }
        catch (err) { setError(errorMessage(err)); }
    };
    const change = async () => {
        setBusy(true);
        setError("");
        try {
            await serverBridge.call(ids.changeMap, { map: choice() });
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const label = (name: string) => mapMode(props.spec, name);

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={props.game.art.icon} alt={props.spec.name} fallbackIcon={props.spec.icon} />}
            detail={
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperText color="text-subtle">
                        {map()}
                        <Show when={label(map())}>{(mode) => ` · ${mode()}`}</Show>
                    </PaperText>
                    <PaperButton size="tiny" icon onClick={() => void edit()} title="Change map" aria-label="Change map">
                        edit
                    </PaperButton>
                </PaperFlex>
            }
            software="Steam"
            control={features.control}
            world={features.actions.includes(A.saveWorld)}
        >
            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Change map"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" disabled={busy() || !choice() || choice() === map()} onClick={() => void change()}>
                            {busy() ? "Changing..." : "Change map"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {serverStatus() === "online"
                        ? "Everyone moves to the new map now, and the server starts on it next time."
                        : "The server starts on this map."}
                </PaperText>
                <PaperSelectMenu
                    name="source-map"
                    fullWidth
                    searchable
                    searchPlaceholder="Search maps"
                    placeholder={maps().length ? "Choose a map" : "Loading maps..."}
                    disabled={maps().length === 0}
                    value={choice()}
                    onValueChange={(value) => setChoice(String(value))}
                >
                    <For each={maps()}>
                        {(name) => <PaperSelectMenuItem value={name} description={label(name)} keywords={label(name)}>{name}</PaperSelectMenuItem>}
                    </For>
                </PaperSelectMenu>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Map not changed">{error()}</PaperQuote>
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
