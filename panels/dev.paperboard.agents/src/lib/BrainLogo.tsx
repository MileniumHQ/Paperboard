// A brain's mark. Claude's keeps its own colour; Codex's and OpenCode's are
// one colour in their sources, so they're drawn in the text colour around
// them (a mask), which keeps them visible in light and dark themes alike.

import { Show } from "solid-js";
import CLAUDE from "../assets/brains/claude-code.svg?url";
import CODEX from "../assets/brains/codex.svg?url";
import OPENCODE from "../assets/brains/opencode.svg?url";
import type { Harness } from "../contract";
import styles from "./BrainLogo.module.css";

const MONO: Partial<Record<Harness, string>> = { codex: CODEX, opencode: OPENCODE };

export default function BrainLogo(props: { harness: Harness }) {
    return (
        <Show when={MONO[props.harness]} fallback={<img class={styles.logo} src={CLAUDE} alt="" aria-hidden="true" draggable={false} />}>
            {(mark) => <span class={`${styles.logo} ${styles.mono}`} style={{ "--brain-logo": `url("${mark()}")` }} aria-hidden="true" />}
        </Show>
    );
}
