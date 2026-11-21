import { For } from "solid-js";
import { PaperColorChip, PaperFlex } from "@mileniumhq/paperui";
import { AGENT_COLORS, COLOR_ROLES, type AgentColor } from "../contract";

/** "teal" as a person reads it: "Teal" */
const named = (c: AgentColor) => c[0]!.toUpperCase() + c.slice(1);

/** The agent's colors in a row, the picked one ringed. */
export default function ColorPicker(props: { value: AgentColor; onPick: (color: AgentColor) => void }) {
    return (
        <PaperFlex direction="row" gap="threefourths" align="center" wrap role="group" aria-label="Color">
            <For each={AGENT_COLORS}>
                {(c) => (
                    <PaperColorChip
                        color={COLOR_ROLES[c]}
                        selected={props.value === c}
                        aria-label={named(c)}
                        title={named(c)}
                        onClick={() => props.onPick(c)}
                    />
                )}
            </For>
        </PaperFlex>
    );
}
