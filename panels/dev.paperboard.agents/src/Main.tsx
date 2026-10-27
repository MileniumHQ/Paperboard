import { Match, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperLoader } from "@mileniumhq/paperui";
import Workspace from "./Workspace";
import Onboarding from "./onboarding/Onboarding";
import { createAgent } from "./lib/agent";
import styles from "./Main.module.css";

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

    return (
        <Switch>
            <Match when={agent.hydration() === "loading"}>
                <div class={styles.center}>
                    <PaperLoader loaderStatus="indeterminate" label="Waking up" />
                </div>
            </Match>
            <Match when={agent.hydration() === "failed"}>
                <div class={styles.center}>
                    <PaperEmptyState icon="cloud_off" title="Couldn't reach the Agents service" description={agent.error() ?? undefined}>
                        <PaperButton onClick={() => void agent.hydrate()}>Try again</PaperButton>
                    </PaperEmptyState>
                </div>
            </Match>
            <Match when={meeting()}>
                <Onboarding
                    agent={agent}
                    onSaving={() => setMine(true)}
                    onDone={() => {
                        setOnboarding(false);
                        setMine(false);
                    }}
                />
            </Match>
            <Match when={agent.state.settings}>
                <Workspace agent={agent} />
            </Match>
        </Switch>
    );
}
