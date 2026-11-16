import { type Component } from "solid-js";
import { PaperEmptyState, PaperFlex } from "@mileniumhq/paperui";
import type { ComputerInfo } from "../../lib/shell";

export interface LandingViewProps {
    computer?: ComputerInfo;
    /** how many panels the computer has, once listed */
    panelCount?: number;
}

// The splash shown on launch (and whenever a tab is closed back to the
// computer root). No panel auto-opens, so this is the first frame the user
// sees on every boot.
const LandingView: Component<LandingViewProps> = (props) => {
    return (
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
    );
};

export default LandingView;
