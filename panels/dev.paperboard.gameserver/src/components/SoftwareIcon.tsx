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
        <Switch fallback={<PaperIcon aria-hidden="true">{symbol()}</PaperIcon>}>
            <Match when={mask()}>
                {(path) => (
                    // the logo's alpha cut out of the text color
                    <PaperIcon aria-hidden="true">
                        <span
                            style={{
                                display: "inline-block",
                                width: "var(--paper-icon-em)",
                                height: "var(--paper-icon-em)",
                                "background-color": "currentColor",
                                "mask-image": `url("${path()}")`,
                                "mask-size": "contain",
                                "mask-repeat": "no-repeat",
                                "mask-position": "center",
                            }}
                        />
                    </PaperIcon>
                )}
            </Match>
            <Match when={image()}>
                {(value) => (
                    <PaperIcon aria-hidden="true">
                        <img
                            src={value().src}
                            alt=""
                            style={{ "image-rendering": value().pixelated ? "pixelated" : "auto" }}
                        />
                    </PaperIcon>
                )}
            </Match>
        </Switch>
    );
}
