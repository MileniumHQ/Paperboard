import { For } from "solid-js";
import { PaperColorChip, PaperFlex } from "@mileniumhq/paperui";
import { AGENT_COLORS, type AgentColor } from "../contract";

/** what each of the agent's colors is called, for screen readers and hover */
const COLOR_NAMES: Record<AgentColor, string> = {
    primary: "Blue",
    "extra-2": "Purple",
    "extra-3": "Pink",
    danger: "Red",
    attention: "Orange",
    warning: "Yellow",
    success: "Green",
    "extra-1": "Teal",
};

/** The agent's colors in a row, the picked one ringed. */
export default function ColorPicker(props: { value: AgentColor; onPick: (color: AgentColor) => void }) {
    return (
        <PaperFlex direction="row" gap="threefourths" align="center" wrap role="group" aria-label="Color">
            <For each={AGENT_COLORS}>
                {(c) => (
                    <PaperColorChip
                        color={c}
                        selected={props.value === c}
                        aria-label={COLOR_NAMES[c]}
                        title={COLOR_NAMES[c]}
                        onClick={() => props.onPick(c)}
                    />
                )}
            </For>
        </PaperFlex>
    );
}
