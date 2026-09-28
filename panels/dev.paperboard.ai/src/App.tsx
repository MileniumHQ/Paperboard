import { Match, onMount, Switch } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperEmptyState,
    PaperLoader,
} from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import "@paperboard-dev/paperui/panel.css";
import "./style.css";
import { hydrate, hydration, hydrationError } from "./lib/state";
import ChatView from "./components/ChatView";

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
            <Match when={true}>
                <ChatView />
            </Match>
        </Switch>
    );
}
