import { Show } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";

// a software's catalog icon: its logo when it has one, else a symbol.
// Decorative: it always sits next to the software's name, and a symbol's
// ligature text ("hardware") must not become part of that name.
export default function SoftwareIcon(props: { software: ServerSoftwareType }) {
    const icon = () => SOFTWARE[props.software].icon;
    const src = () => {
        const value = icon();
        return "src" in value ? value.src : undefined;
    };
    const symbol = () => {
        const value = icon();
        return "symbol" in value ? value.symbol : "";
    };
    return (
        <Show when={src()} fallback={<PaperIcon aria-hidden="true">{symbol()}</PaperIcon>}>
            {(path) => <PaperIcon aria-hidden="true" src={path()} />}
        </Show>
    );
}
