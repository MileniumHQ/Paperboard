import { Show } from "solid-js";
import { PaperAvatar, PaperCopyButton, PaperError, PaperFlex, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { valheim } from "./index";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";

export default function ValheimOverview() {
    const { calls, gameSettings, serverStatus } = useServer();
    // with crossplay, the join code the relay gives once the server registered with it
    const session = createMetrics(calls.valheimSession);
    const uptime = createUptime();
    const world = () => String(gameSettings().world ?? "");
    // the name players see in the server list
    const name = () => String(gameSettings().name ?? "");
    const crossplay = () => gameSettings().crossplay === true;
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
                crossplay()
                    ? { icon: "key", label: "Join code", value: joinCode() ?? "…" }
                    : { icon: "list", label: "Server list", value: gameSettings().public === true ? "Listed" : "Not listed" },
            )}
        >
            <Show when={session.error()}>
                {(err) => (
                    <PaperError
                        title="Couldn't read the server's join code"
                        error={err()}
                        action={{ label: "Try again", disabled: session.loading(), onClick: () => void session.reload() }}
                    />
                )}
            </Show>
            <Show when={crossplay() && serverStatus() === "online"}>
                <PaperQuote variant="monochrome" icon="hub" title="Crossplay joins through Valheim's relay">
                    <Show when={joinCode()} fallback="The server is registering with the relay; its join code shows here once it has one.">
                        {(code) => `Players join with code ${code()}${session.value()?.address ? `, or at ${session.value()!.address}` : ""}. A crossplay server can't be joined at a local address.`}
                    </Show>
                </PaperQuote>
            </Show>
        </ServerOverview>
    );
}
