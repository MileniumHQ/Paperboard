// A brain's mark. Brand marks come from thesvg (@thesvg/icons, MIT). Claude's
// keeps its own colour; OpenAI's is one colour in its source, so it's drawn in
// the text colour (a tinted icon), which keeps it visible in light and dark
// themes alike. The text colour is named: a selector colours its icons with the
// primary colour. Other provider uses a Material symbol instead of a brand mark.

import { Match, Switch } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import CLAUDE from "../assets/brains/claude-code.svg?url";
import OPENAI from "../assets/brains/codex.svg?url";
import type { Harness } from "../contract";

export default function BrainLogo(props: { harness: Harness }) {
    return (
        <Switch fallback={<PaperIcon>hub</PaperIcon>}>
            <Match when={props.harness === "codex"}>
                <PaperIcon src={OPENAI} tint="text" />
            </Match>
            <Match when={props.harness === "claude-code"}>
                <PaperIcon src={CLAUDE} tint={false} />
            </Match>
        </Switch>
    );
}
