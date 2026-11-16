import { onCleanup, Show, type JSX } from "solid-js";
import { PaperButton, PaperCenteredInterface, PaperFlex, createFailureToast, useWizard } from "@mileniumhq/paperui";
import InstallLoaders, { type InstallLoaderItem } from "./InstallLoaders";
import FailureOutput from "./FailureOutput";
import { splitFailure } from "../lib/failure";

/**
 * Runs a setup wizard's install: Back and Next are hidden while it runs, and
 * Next opens once it has succeeded. A step the user has left stops
 * reporting; `disposed` tells an install that it was.
 */
export function createWizardInstall(install: () => Promise<boolean>) {
    const wizard = useWizard();
    let disposed = false;
    onCleanup(() => { disposed = true; });
    const run = async (): Promise<boolean> => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        const ok = await install();
        if (!disposed) {
            wizard?.setCanProceed(ok);
            wizard?.setOptionsShown(true);
        }
        return ok;
    };
    return { run, wizard, disposed: () => disposed };
}

/**
 * The install step of every game's setup wizard: its rows, and a failure
 * with Retry beside what else the user can do. The failure's first line is
 * a toast; what the tool printed after it stays here.
 */
export default function InstallStepView(props: {
    rows: InstallLoaderItem[];
    error: string;
    onRetry(): void;
    /** buttons after Retry setup, such as the way back to the choices */
    actions?: JSX.Element;
    /** notices above the failure */
    children?: JSX.Element;
}) {
    createFailureToast(() => props.error && splitFailure(props.error).summary, { title: "Couldn't set up the server" });
    return (
        <PaperCenteredInterface>
            <PaperFlex direction="column" gap="full" center fullWidth>
                {props.children}
                <Show when={props.error}>
                    <FailureOutput message={props.error} />
                    <PaperFlex gap="half">
                        <PaperButton onClick={props.onRetry}>Retry setup</PaperButton>
                        {props.actions}
                    </PaperFlex>
                </Show>
                <InstallLoaders items={props.rows} />
            </PaperFlex>
        </PaperCenteredInterface>
    );
}
