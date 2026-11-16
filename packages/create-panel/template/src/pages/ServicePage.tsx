// A page backed by the panel's service. The service owns the state; the page
// mirrors it through its client, so a greeting given in one window (or by
// another panel's Greet block) shows up in every window at once.
import { createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import {
    createRead,
    PaperButton,
    PaperCard,
    PaperError,
    PaperFlex,
    PaperInput,
    PaperLoader,
    PaperPageHeader,
    PaperText,
    showError,
} from "@mileniumhq/paperui";
import { serviceClient } from "@mileniumhq/paperapi";
import { panelContract } from "../panel";

export default function ServicePage() {
    const service = serviceClient(panelContract);
    const [state, setState] = createSignal(service.state.current());
    const [name, setName] = createSignal("");
    const [greeting, setGreeting] = createSignal("");
    const [busy, setBusy] = createSignal(false);

    const off = service.state.subscribe((full) => setState({ ...full }));
    onCleanup(() => {
        off();
        service.state.dispose();
    });

    // unavailable is not empty: a service that has not answered is said, with a way to try again
    const hydrated = createRead(async () => {
        setState({ ...(await service.state.refresh()) });
        return true;
    });

    const greet = async () => {
        if (busy()) return;
        setBusy(true);
        setGreeting("");
        try {
            // the service refuses a bad name with a reason; the new count
            // arrives through its state, not through this answer
            setGreeting(await service.calls.greet({ name: name() }));
        } catch (err) {
            showError("Couldn't greet", err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="sync_alt" title="Service" subtitle="Asks the panel's background service and mirrors what it keeps" />
            <Switch>
                <Match when={hydrated.value()}>
                    <PaperCard>
                        <PaperFlex direction="column" padding="full" gap="full">
                            <PaperText>Greetings given so far: {state().greetingCount}</PaperText>
                            <PaperInput
                                fullWidth
                                label="Name"
                                value={name()}
                                onInput={(e) => setName(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") void greet();
                                }}
                            />
                            <PaperFlex direction="row" gap="half" align="center">
                                <PaperButton disabled={busy()} onClick={() => void greet()}>
                                    Greet
                                </PaperButton>
                                <Show when={greeting()}>
                                    <PaperText>{greeting()}</PaperText>
                                </Show>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperCard>
                </Match>
                <Match when={hydrated.error()}>
                    {(err) => (
                        <PaperError
                            fill
                            title="Couldn't reach the service"
                            error={err()}
                            action={{ label: "Try again", disabled: hydrated.loading(), onClick: () => void hydrated.reload() }}
                        />
                    )}
                </Match>
                <Match when={true}>
                    <PaperLoader loaderStatus="indeterminate" label="Connecting to the service" />
                </Match>
            </Switch>
        </>
    );
}
