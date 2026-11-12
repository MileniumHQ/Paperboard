import { Match, onMount, Switch } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperEmptyState,
    PaperLoader,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "./style.css";
import { hydrate, hydration, hydrationError, state } from "./lib/state";
import ChatView from "./components/ChatView";
import Setup from "./components/Setup";

export default function App() {
    onMount(() => void hydrate());

    return (
        <Switch>
            <Match when={hydration() === "loading"}>
                <PaperCenteredInterface size="compact">
                    <PaperLoader loaderStatus="indeterminate" label="Connecting to the AI service" />
                </PaperCenteredInterface>
            </Match>
            <Match when={hydration() === "failed"}>
                <PaperCenteredInterface size="compact">
                    <PaperEmptyState icon="cloud_off" title="The AI service is not answering" description={hydrationError()} />
                    <PaperButton variant="primary" onClick={() => void hydrate()}>Try again</PaperButton>
                </PaperCenteredInterface>
            </Match>
            <Match when={state.connections.length === 0}>
                <Setup />
            </Match>
            <Match when={true}>
                <ChatView />
            </Match>
        </Switch>
    );
}
