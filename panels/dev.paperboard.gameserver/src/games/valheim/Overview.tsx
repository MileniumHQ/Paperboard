import { Show } from "solid-js";
import { PaperAvatar, PaperCopyButton, PaperError, PaperFlex, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { valheim } from "./index";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";

export default function ValheimOverview() {
    const { calls, gameSettings } = useServer();
    // what the running server was started with, and with crossplay the relay's join code
    const session = createMetrics(calls.valheimSession);
    const uptime = createUptime();
    // options are for the next start; while it runs, these are the run's own
    const world = () => session.value()?.world ?? String(gameSettings().world ?? "");
    const listed = () => session.value()?.listed ?? gameSettings().public === true;
    // the name players see in the server list
    const name = () => String(gameSettings().name ?? "");
    const joinCode = () => session.value()?.joinCode ?? null;

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={valheim.art.icon} alt="Valheim" fallbackIcon="forest" />}
            detail={
                <PaperFlex direction="row" gap="half" align="center" wrap>
                    <PaperText color="text-subtle">{name()}</PaperText>
                    <Show when={joinCode()}>
                        {(code) => (
                            <PaperFlex direction="row" gap="onefourth" align="center">
                                <PaperText color="text-subtle">· Join code {code()}</PaperText>
                                <PaperCopyButton text={code()} title="Copy join code" />
                            </PaperFlex>
                        )}
                    </Show>
                </PaperFlex>
            }
            software="Steam"
            control={valheim.describe({ software: "", version: "" }).control}
            // Valheim saves on its own and as it stops; it can't be asked to save
            world={false}
            stats={overviewStats(
                uptime(),
                { icon: "public", label: "World", value: world() },
                { icon: "list", label: "Server list", value: listed() ? "Listed" : "Not listed" },
            )}
        >
            <Show when={session.error()}>
                {(err) => (
                    <PaperError
                        title="Couldn't read the running server's session"
                        error={err()}
                        action={{ label: "Try again", disabled: session.loading(), onClick: () => void session.reload() }}
                    />
                )}
            </Show>
            <Show when={session.value()?.crossplay}>
                <PaperQuote variant="monochrome" icon="hub" title="Crossplay joins through Valheim's relay">
                    <Show when={joinCode()} fallback="The server is registering with the relay; its join code shows above once it has one.">
                        {`Players join with the join code above${session.value()?.address ? `, or at ${session.value()!.address}` : ""}. A crossplay server can't be joined at a local address.`}
                    </Show>
                </PaperQuote>
            </Show>
        </ServerOverview>
    );
}
