import { createEffect, createSignal, on, Show } from "solid-js";
import {
    PaperButton,
    PaperCopyButton,
    PaperFlex,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
    keepUnchanged,
    createLatest,
} from "@mileniumhq/paperui";
import ConfigSettings from "./ConfigSettings";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import { crossplayPlatform, disableCrossplay, enableCrossplay, readCrossplay } from "../lib/crossplay";
import { localIp, serverBridge, serverSoftware, serverStatus } from "../lib/server";
import { CALLS } from "../service/contract";
import type { CrossplayView } from "../service/crossplay";
import { BEDROCK_PORT_SETTING_ID } from "../software/crossplay";

// Crossplay: one switch for Geyser and Floodgate, then their settings.
// Turning it off removes the jars and keeps their settings folders, so
// turning it back on picks up where it left off.
export default function Crossplay(props: { active: boolean }) {
    const [view, setView] = createSignal<CrossplayView | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [error, setError] = createSignal("");

    const latest = createLatest();
    // a view read again, or answered by a save, keeps the rows it did not change
    const show = (next: CrossplayView) => setView((prev) => keepUnchanged(prev, next));
    const load = async () => {
        setLoadError("");
        const current = latest();
        try {
            const answer = await readCrossplay();
            if (current()) show(answer);
        } catch (err) {
            if (current()) setLoadError(errorMessage(err));
        }
    };

    createEffect(
        on([() => props.active, serverSoftware], ([active]) => {
            if (active && crossplayPlatform()) void load();
        }),
    );

    const enabled = () => Boolean(view()?.geyser && view()?.floodgate);

    // Turning crossplay on downloads Geyser and Floodgate, which takes a
    // while; the switch shows where it is going at once, and a second press
    // waits for the first to finish instead of racing it
    const saves = createSaves({ failed: (err) => setError(errorMessage(err)), changed: () => setError("") });
    const crossplay = saves.setting("crossplay", enabled, async (on) => {
        const current = view();
        if (!current) throw new Error("Crossplay has not been read yet");
        try {
            show(on ? await enableCrossplay(current) : await disableCrossplay(current));
        } catch (err) {
            // whatever did land is what the switch shows
            await load();
            throw err;
        }
    });

    const bedrockPort = () =>
        view()
            ?.groups.flatMap((group) => group.settings)
            .find((setting) => setting.id === BEDROCK_PORT_SETTING_ID)?.value;

    const half = () => {
        const current = view();
        if (!current || enabled()) return null;
        return current.geyser || current.floodgate ? "Crossplay is only partly installed." : null;
    };

    const status = () => {
        if (crossplay.saving()) return crossplay.value() ? "Turning on…" : "Turning off…";
        return "Bedrock players can join.";
    };

    return (
        <>
            <PaperPageHeader icon="devices" title="Crossplay" />
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read crossplay">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={view()}>
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Crossplay" description={status()}>
                        <PaperToggle checked={crossplay.value()} onChange={crossplay.set} />
                    </PaperSettingItem>
                </PaperSettingList>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Crossplay did not change" onDismiss={() => setError("")}>
                        {error()}
                    </PaperQuote>
                </Show>
                <Show when={half()}>
                    {(note) => (
                        <PaperQuote variant="warning" icon="info" title="Half installed">
                            {note()} Turn crossplay on to finish, or off to remove it.
                        </PaperQuote>
                    )}
                </Show>
                {/* its settings belong to the installed jars: gone the moment the switch turns off */}
                <Show when={enabled() && crossplay.value()}>
                    <Show when={serverStatus() !== "offline"}>
                        <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                            Restart the server so Bedrock players can join and these settings take effect.
                        </PaperQuote>
                    </Show>
                    {/* the port is Geyser's setting: a config it could not read says why below */}
                    <Show when={bedrockPort()}>
                        {(port) => (
                            <PaperSettingList autoHeight>
                                <PaperSettingItem
                                    title="Bedrock address"
                                    description="What Bedrock players add under Servers."
                                >
                                    <PaperFlex direction="row" gap="half" align="center">
                                        <PaperText weight={700}>
                                            {localIp()}:{port()}
                                        </PaperText>
                                        <PaperCopyButton text={`${localIp()}:${port()}`} title="Copy Bedrock address" />
                                    </PaperFlex>
                                </PaperSettingItem>
                            </PaperSettingList>
                        )}
                    </Show>
                    <ConfigSettings
                        groups={view()!.groups}
                        write={(id, value) => serverBridge.call(CALLS.writeCrossplaySetting, { id, value })}
                        reload={load}
                        plain
                    />
                    <PaperText size={2} color="text-subtle">
                        Crossplay runs on Geyser and Floodgate by GeyserMC.
                    </PaperText>
                </Show>
            </Show>
        </>
    );
}
