import { Match, Switch } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";

// a software's catalog icon: its logo when it has one, else a symbol.
// Decorative: it always sits next to the software's name, and a symbol's
// ligature text ("hardware") must not become part of that name.
export default function SoftwareIcon(props: { software: ServerSoftwareType }) {
    const icon = () => SOFTWARE[props.software].icon;
    const mask = () => {
        const value = icon();
        return "mask" in value ? value.mask : undefined;
    };
    const image = () => {
        const value = icon();
        return "src" in value ? value : undefined;
    };
    const symbol = () => {
        const value = icon();
        return "symbol" in value ? value.symbol : "";
    };
    return (
        <Switch fallback={<PaperIcon>{symbol()}</PaperIcon>}>
            <Match when={mask()}>
                {(path) => <PaperIcon src={path()} tint />}
            </Match>
            <Match when={image()}>
                {(value) => <PaperIcon src={value().src} pixelated={value().pixelated} />}
            </Match>
        </Switch>
    );
}
