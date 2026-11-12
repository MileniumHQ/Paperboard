import { Show } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import styles from "./AgentLogo.module.css";

// Each agent's own mark, from its project (sources in assets/agents/NOTICE.md),
// shown as an image: never inlined into the page.
const LOGOS = import.meta.glob("../assets/agents/*.{png,svg}", { query: "?url", import: "default", eager: true }) as Record<string, string>;

function logoFor(agent: string | undefined): string | undefined {
    if (!agent) return undefined;
    return LOGOS[`../assets/agents/${agent}.png`] ?? LOGOS[`../assets/agents/${agent}.svg`];
}

/**
 * An agent's logo, sized by the surrounding icon slot; a terminal glyph when
 * it has none. `large` sets it in a tile the size of a model card's maker logo.
 */
export default function AgentLogo(props: { agent?: string; size?: "large" }) {
    const logo = () => (
        <Show when={logoFor(props.agent)} fallback={<PaperIcon zeroHeight>terminal</PaperIcon>}>
            {(src) => <img class={styles.AgentLogo} src={src()} alt="" aria-hidden="true" draggable={false} />}
        </Show>
    );
    return (
        <Show when={props.size === "large"} fallback={logo()}>
            <span class={styles.large} aria-hidden="true">
                {logo()}
            </span>
        </Show>
    );
}
