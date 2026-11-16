import { type Component, Show } from "solid-js";
import { PaperEmptyState, PaperError, PaperFlex } from "@mileniumhq/paperui";
import type { ComputerInfo } from "../../lib/shell";

export interface LandingViewProps {
    computer?: ComputerInfo;
    /** how many panels the computer has, once listed */
    panelCount?: number;
    /** why the computer's panels couldn't be listed, while they can't */
    loadError?: string;
    /** lists the computer's panels again */
    onRetry: () => void;
}

// The splash shown on launch (and whenever a tab is closed back to the
// computer root). No panel auto-opens, so this is the first frame the user
// sees on every boot. A computer whose panels couldn't be listed, with none
// listed before, says so here instead: it has no "No panels yet" to know.
const LandingView: Component<LandingViewProps> = (props) => {
    return (
        <Show
            when={!props.panelCount && props.loadError}
            fallback={
                <PaperFlex center fullWidth fullHeight>
                    <PaperEmptyState
                        icon="computer"
                        title={props.computer?.name || "This Computer"}
                        description={
                            props.panelCount === 0
                                ? "No panels yet. Find some in the Panel Library."
                                : "Choose a panel from the sidebar, or find more in the Panel Library."
                        }
                    />
                </PaperFlex>
            }
        >
            {(why) => (
                <PaperFlex direction="column" fullWidth fullHeight>
                    <PaperError
                        fill
                        title="Couldn't load this computer's panels"
                        error={why()}
                        action={{ label: "Try again", onClick: () => props.onRetry() }}
                    />
                </PaperFlex>
            )}
        </Show>
    );
};

export default LandingView;
