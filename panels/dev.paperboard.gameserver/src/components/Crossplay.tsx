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
} from "@mileniumhq/paperui";
import ConfigSettings from "./ConfigSettings";
import { errorMessage } from "../lib/failure";
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
    const [working, setWorking] = createSignal<"on" | "off" | null>(null);
    const [error, setError] = createSignal("");

    const load = async () => {
        setLoadError("");
        try {
            setView(await readCrossplay());
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };

    createEffect(
        on([() => props.active, serverSoftware], ([active]) => {
            if (active && crossplayPlatform()) void load();
        }),
    );

    const enabled = () => Boolean(view()?.geyser && view()?.floodgate);

    const toggle = async (on: boolean) => {
        const current = view();
        if (!current) return;
        setWorking(on ? "on" : "off");
        setError("");
        try {
            setView(on ? await enableCrossplay(current) : await disableCrossplay(current));
        } catch (err) {
            setError(errorMessage(err));
            // whatever did land is what the switch shows
            await load();
        } finally {
            setWorking(null);
        }
    };

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
        if (working() === "on") return "Turning on…";
        if (working() === "off") return "Turning off…";
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
                        <PaperToggle
                            checked={enabled()}
                            disabled={working() !== null}
                            onChange={(checked) => void toggle(checked)}
                        />
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
                <Show when={enabled()}>
                    <Show when={serverStatus() !== "offline"}>
                        <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                            Restart the server so Bedrock players can join and these settings take effect.
                        </PaperQuote>
                    </Show>
                    <PaperSettingList autoHeight>
                        <PaperSettingItem
                            title="Bedrock address"
                            description="What Bedrock players add under Servers."
                        >
                            <PaperFlex direction="row" gap="half" align="center">
                                <PaperText weight={700}>
                                    {localIp()}:{bedrockPort()}
                                </PaperText>
                                <PaperCopyButton text={`${localIp()}:${bedrockPort()}`} title="Copy Bedrock address" />
                            </PaperFlex>
                        </PaperSettingItem>
                    </PaperSettingList>
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
