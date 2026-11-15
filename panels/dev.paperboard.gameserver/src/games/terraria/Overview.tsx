import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { MotdEditor, MotdPreview } from "../../components/Motd";
import { gameSettings, serverMotd, serverSoftware } from "../../lib/server";
import { createUptime, overviewStats } from "../../components/overviewStats";
import { terraria } from "./index";
import { terrariaMotd } from "./motd";
import { softwareName, terrariaSoftware } from "./catalog";
import { serverCalls } from "../../lib/api";

export default function TerrariaOverview() {
    const [motdOpen, setMotdOpen] = createSignal(false);
    const [motdPending, setMotdPending] = createSignal(false);
    const uptime = createUptime();
    const saveMotd = async (motd: string) => {
        const result = await serverCalls.terrariaMotd({ motd });
        setMotdPending(result.appliesOnRestart);
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={terraria.art.icon} alt="Terraria" fallbackIcon="landscape" />}
            detail={
                <EditableDetail edit="Edit message of the day" onEdit={() => setMotdOpen(true)}>
                    <Show when={serverMotd()} fallback={<PaperText color="text-subtle">No message of the day</PaperText>}>
                        <MotdPreview motd={serverMotd()} dialect={terrariaMotd} />
                    </Show>
                </EditableDetail>
            }
            software={softwareName(terrariaSoftware(serverSoftware()))}
            stats={overviewStats(
                uptime(),
                { icon: "public", label: "World", value: String(gameSettings().world ?? "World") },
                { icon: gameSettings().password ? "lock" : "lock_open", label: "Join password", value: gameSettings().password ? "On" : "Off" },
            )}
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
                load={async () => String((await serverCalls.readGameOptions()).motd ?? "")}
                save={saveMotd}
            />
        </ServerOverview>
    );
}
