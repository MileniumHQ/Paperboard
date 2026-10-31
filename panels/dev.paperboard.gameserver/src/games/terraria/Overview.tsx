import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperFlex, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { MotdEditor, MotdPreview } from "../../components/Motd";
import { serverBridge, serverMotd, serverSoftware } from "../../lib/server";
import { terraria } from "./index";
import { terrariaMotd } from "./motd";
import { softwareName, terrariaSoftware } from "./catalog";

export default function TerrariaOverview() {
    const [motdOpen, setMotdOpen] = createSignal(false);
    const [motdPending, setMotdPending] = createSignal(false);
    const saveMotd = async (motd: string) => {
        const result = await serverBridge.call<{ appliesOnRestart: boolean }>("terraria-motd", { motd });
        setMotdPending(result.appliesOnRestart);
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={terraria.art.icon} alt="Terraria" fallbackIcon="landscape" />}
            detail={
                <PaperFlex direction="row" gap="half" align="center">
                    <Show when={serverMotd()} fallback={<PaperText color="text-subtle">No message of the day</PaperText>}>
                        <MotdPreview motd={serverMotd()} dialect={terrariaMotd} />
                    </Show>
                    <PaperButton
                        size="tiny"
                        icon
                        onClick={() => setMotdOpen(true)}
                        title="Edit message of the day"
                        aria-label="Edit message of the day"
                    >
                        edit
                    </PaperButton>
                </PaperFlex>
            }
            software={softwareName(terrariaSoftware(serverSoftware()))}
        >
            <Show when={motdPending()}>
                <PaperQuote variant="warning" icon="info" title="Message cleared" onDismiss={() => setMotdPending(false)}>
                    Players keep seeing the old message until the server restarts.
                </PaperQuote>
            </Show>

            <MotdEditor
                open={motdOpen()}
                onClose={() => setMotdOpen(false)}
                dialect={terrariaMotd}
                title="Message of the day"
                source="the server's options"
                load={async () => String((await serverBridge.call<Record<string, unknown>>("read-game-options")).motd ?? "")}
                save={saveMotd}
            />
        </ServerOverview>
    );
}
