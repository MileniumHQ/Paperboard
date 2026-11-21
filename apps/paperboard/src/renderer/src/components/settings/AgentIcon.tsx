// A coding agent's mark, by the id trissue gives the agent. The marks come
// from thesvg (@thesvg/icons, MIT). A mark drawn in a single gray is
// <id>.mono.svg: it's drawn in the text color, so a black or white logo
// reads in both themes. Every other mark keeps its own colors. An agent
// without a mark gets the generic agent symbol.
import { Show, type JSX } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import styles from "./AgentIcon.module.css";

const files = import.meta.glob<string>("../../assets/agents/*.svg", { eager: true, query: "?url", import: "default" });

const marks = new Map<string, { url: string; mono: boolean }>();
for (const [file, url] of Object.entries(files)) {
    const name = file.slice(file.lastIndexOf("/") + 1, -".svg".length);
    const mono = name.endsWith(".mono");
    marks.set(mono ? name.slice(0, -".mono".length) : name, { url, mono });
}

export function AgentIcon(props: { id: string }): JSX.Element {
    return (
        <Show when={marks.get(props.id)} fallback={<PaperIcon class={styles.symbol}>smart_toy</PaperIcon>}>
            {(mark) => (
                <Show when={mark().mono} fallback={<img class={styles.mark} src={mark().url} alt="" />}>
                    <span class={styles.mono} style={{ "--agent-mark": `url("${mark().url}")` }} aria-hidden="true" />
                </Show>
            )}
        </Show>
    );
}
