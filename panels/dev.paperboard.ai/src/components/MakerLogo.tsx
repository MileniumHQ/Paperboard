import { Show } from "solid-js";
import { PaperIcon } from "@paperboard-dev/paperui";
import styles from "./MakerLogo.module.css";

// bundled monochrome SVGs (fill="currentColor"), so they follow the theme
const LOGOS = import.meta.glob("../assets/makers/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function logoFor(icon: string | null | undefined): string | undefined {
    return icon ? LOGOS[`../assets/makers/${icon}.svg`] : undefined;
}

/** A maker's logo; a generic model glyph when the maker has none. */
export default function MakerLogo(props: { icon?: string | null; size?: "small" | "medium" | "large" }) {
    return (
        <span class={styles.MakerLogo} classList={{ [styles[props.size ?? "medium"]!]: true }} aria-hidden="true">
            <Show when={logoFor(props.icon)} fallback={<PaperIcon>neurology</PaperIcon>}>
                {/* static, bundled at build time: not user or model content */}
                <span class={styles.svg} innerHTML={logoFor(props.icon)} />
            </Show>
        </span>
    );
}
