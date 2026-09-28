import { type Component } from "solid-js";
import { PaperFlex, PaperText } from "@paperboard-dev/paperui";
import type { ComputerItem } from "../../App";

export interface LandingViewProps {
    computer?: ComputerItem;
}

// The splash shown on launch (and whenever a tab is closed back to the
// computer root). No panel auto-opens, so this is the first frame the user
// sees on every boot.
const LandingView: Component<LandingViewProps> = (props) => {
    return (
        <PaperFlex center fullWidth fullHeight gap="full">
            <PaperFlex center direction="column" gap="double">
                <PaperFlex center direction="column" gap="onefourth">
                    <PaperText weight={700} size={5} color="text">
                        {props.computer?.name || "This Computer"}
                    </PaperText>
                    <PaperText weight={400} size={3} color="text-subtle">
                        Select a panel from the sidebar or open the panel library to
                        get started.
                    </PaperText>
                </PaperFlex>
            </PaperFlex>
        </PaperFlex>
    );
};

export default LandingView;
