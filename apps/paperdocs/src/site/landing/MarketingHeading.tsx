import { Dynamic } from "solid-js/web";
import { styledText } from "./TextEffect";

/** Real heading text stays available before the decorative element upgrades. */
export function MarketingHeading(props: { level: 1 | 2; text: string; size: number }) {
    return (
        <Dynamic component={`h${props.level}`} class="marketing-heading">
            <span class="marketing-heading-label">{props.text}</span>
            <span
                class="styled-text-host"
                aria-hidden="true"
                innerHTML={styledText(props.text, props.size)}
            />
        </Dynamic>
    );
}
