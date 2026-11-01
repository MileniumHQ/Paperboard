import { Show } from "solid-js";
import { PaperQuote } from "@mileniumhq/paperui";
import { serverStatus } from "../lib/server";
import type { Outcome } from "../lib/failure";

export interface HostSupport {
    supported: boolean;
    reason?: string;
}

/** Why a game's server cannot run on this computer, as setup and Versions say it. */
export function UnsupportedHost(props: { game: string; host: HostSupport | null }) {
    return (
        <Show when={props.host && !props.host.supported}>
            <PaperQuote variant="warning" icon="warning" title={`This computer can't run ${props.game} yet`}>
                {props.host?.reason}
            </PaperQuote>
        </Show>
    );
}

/**
 * What stands in the way of installing, above a Versions tab: a server that
 * has to be stopped first, what could not be read, and a computer the game
 * does not run on.
 */
export default function InstallNotices(props: {
    game: string;
    /** what stopping the server is for: "reinstall or change its version" */
    stopFor: string;
    loadFailure?: Outcome;
    host: HostSupport | null;
}) {
    return (
        <>
            <Show when={serverStatus() !== "offline"}>
                <PaperQuote variant="warning" icon="warning" title="Server running">
                    Stop the server to {props.stopFor}.
                </PaperQuote>
            </Show>
            <Show when={props.loadFailure}>
                {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}>{note().message}</PaperQuote>}
            </Show>
            <UnsupportedHost game={props.game} host={props.host} />
        </>
    );
}
