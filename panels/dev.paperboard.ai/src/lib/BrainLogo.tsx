// A brain's mark. Claude's keeps its own colour; Codex's is one colour in
// its source, so it's drawn in the text colour around it (a mask), which
// keeps it visible in light and dark themes alike.

import { Show } from "solid-js";
import CLAUDE from "../assets/brains/claude-code.svg?url";
import CODEX from "../assets/brains/codex.svg?url";
import type { Harness } from "../contract";
import styles from "./BrainLogo.module.css";

export default function BrainLogo(props: { harness: Harness }) {
    return (
        <Show
            when={props.harness === "codex"}
            fallback={<img class={styles.logo} src={CLAUDE} alt="" aria-hidden="true" draggable={false} />}
        >
            <span class={`${styles.logo} ${styles.mono}`} style={{ "--brain-logo": `url("${CODEX}")` }} aria-hidden="true" />
        </Show>
    );
}
