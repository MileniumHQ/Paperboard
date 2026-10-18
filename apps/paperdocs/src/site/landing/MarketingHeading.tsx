import { Dynamic } from "solid-js/web";
import { For } from "solid-js";
import { styledText } from "./TextEffect";

// Average advance of Nunito 800 per character, in em. Only used to pick the
// size at which the longest line fills the heading's width; the svg still
// caps itself at 100% if a line runs wider than estimated.
const NUNITO_ADVANCE = 0.56;

/**
 * Real heading text stays available before the decorative element upgrades.
 * `lines` are the places the heading may wrap: they sit on one row when it
 * fits and stack on narrow screens, all at one type size.
 */
export function MarketingHeading(props: {
    level: 1 | 2;
    text: string;
    lines?: string[];
    size: number;
}) {
    const lines = () => props.lines ?? [props.text];
    const fit = () => {
        const longest = Math.max(...lines().map((line) => line.length));
        return (96 / (longest * NUNITO_ADVANCE)).toFixed(2);
    };
    return (
        <Dynamic component={`h${props.level}`} class="marketing-heading">
            <span class="marketing-heading-label">{props.text}</span>
            <span
                class="marketing-heading-lines"
                aria-hidden="true"
                style={{ "--heading-size": `${props.size}px`, "--heading-fit": `${fit()}cqi` }}
            >
                <For each={lines()}>
                    {(line) => <span class="styled-text-host" innerHTML={styledText(line, props.size, true)} />}
                </For>
            </span>
        </Dynamic>
    );
}
