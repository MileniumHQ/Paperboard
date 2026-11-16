import { Show } from "solid-js";
import {
    PaperCopyButton,
    PaperError,
    PaperFlex,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
    createRead,
    showError,
} from "@mileniumhq/paperui";
import ConfigSettings from "./ConfigSettings";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import { crossplayPlatform, disableCrossplay, enableCrossplay } from "../lib/crossplay";
import { useServer } from "../lib/server";
import { BEDROCK_PORT_SETTING_ID } from "../software/crossplay";

// Crossplay: one switch for Geyser and Floodgate, then their settings.
// Turning it off removes the jars and keeps their settings folders, so
// turning it back on picks up where it left off.
export default function Crossplay(props: { active: boolean }) {
    const server = useServer();
    const { calls, localIp, serverSoftware, serverStatus } = server;
    // read whenever the tab opens or the software changes; a view read
    // again, or answered by a save, keeps the rows it did not change
    const read = createRead(() => calls.readCrossplay(), {
        source: () => props.active && crossplayPlatform(serverSoftware()) !== null && serverSoftware(),
        message: errorMessage,
    });
    const view = read.value;
    const load = read.reload;

    const enabled = () => Boolean(view()?.geyser && view()?.floodgate);

    // Turning crossplay on downloads Geyser and Floodgate, which takes a
    // while; the switch shows where it is going at once, and a second press
    // waits for the first to finish instead of racing it
    const saves = createSaves({ failed: (err) => showError("Couldn't change crossplay", errorMessage(err)) });
    const crossplay = saves.setting("crossplay", enabled, async (on) => {
        const current = view();
        if (!current) throw new Error("Crossplay has not been read yet");
        try {
            read.set(on ? await enableCrossplay(server, current) : await disableCrossplay(server, current));
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
            {/* above crossplay as it was read before, or in its place */}
            <Show when={read.error()}>
                {(err) => (
                    <PaperError
                        fill={!view()}
                        title="Couldn't load crossplay"
                        error={err()}
                        action={{ label: "Try again", disabled: read.loading(), onClick: () => void load() }}
                    />
                )}
            </Show>
            <Show when={view()}>
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Crossplay" description={status()}>
                        <PaperToggle checked={crossplay.value()} onChange={crossplay.set} />
                    </PaperSettingItem>
                </PaperSettingList>
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
                        write={(id, value) => calls.writeCrossplaySetting({ id, value })}
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
