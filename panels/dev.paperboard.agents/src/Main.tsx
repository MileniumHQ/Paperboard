import { Match, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperLoader, PaperPresence } from "@mileniumhq/paperui";
import Workspace from "./Workspace";
import Onboarding from "./onboarding/Onboarding";
import { createAgent } from "./lib/agent";
import "./tokens.css";

/**
 * The panel: the service's agent, met for the first time or chatted with.
 * Nothing waits on this window: closing it leaves the agent, its computer
 * and a running turn with the service.
 */
export default function Main() {
    const agent = createAgent();
    onCleanup(agent.dispose);

    // onboarding opens when there's no agent yet. The window that saves the
    // settings keeps it open to show the computer's setup; any other window
    // goes straight to the chat once the agent exists.
    const [onboarding, setOnboarding] = createSignal(false);
    const [mine, setMine] = createSignal(false);
    createEffect(() => {
        if (agent.hydration() === "ready" && !agent.state.settings && !onboarding()) setOnboarding(true);
    });
    const meeting = () => onboarding() && (!agent.state.settings || mine());
    // the chat fades in after the onboarding has faded out; opening a panel that already has an agent shows it at once
    const [metHere, setMetHere] = createSignal(false);

    return (
        <Switch>
            <Match when={agent.hydration() === "loading"}>
                <PaperFlex center fullHeight padding="double">
                    <PaperLoader loaderStatus="indeterminate" label="Waking up" />
                </PaperFlex>
            </Match>
            <Match when={agent.hydration() === "failed"}>
                <PaperFlex center fullHeight padding="double">
                    <PaperEmptyState icon="cloud_off" title="Couldn't reach the Agent service" description={agent.error() ?? undefined}>
                        <PaperButton onClick={() => void agent.hydrate()}>Try again</PaperButton>
                    </PaperEmptyState>
                </PaperFlex>
            </Match>
            <Match when={meeting()}>
                <Onboarding
                    agent={agent}
                    onSaving={() => setMine(true)}
                    onDone={() => {
                        setMetHere(true);
                        setOnboarding(false);
                        setMine(false);
                    }}
                />
            </Match>
            <Match when={agent.state.settings}>
                <PaperPresence when appear={metHere()} motion="fade">
                    <PaperFlex fullHeight>
                        <Workspace agent={agent} />
                    </PaperFlex>
                </PaperPresence>
            </Match>
        </Switch>
    );
}
