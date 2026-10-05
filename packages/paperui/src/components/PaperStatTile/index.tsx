import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { PaperProgress } from "../PaperProgress";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";

export interface PaperStatTileMeter {
    value: number;
    max: number;
    /** defaults to the tile tone */
    variant?: PaperRole;
}

export interface PaperStatTileProps extends JSX.HTMLAttributes<HTMLDivElement> {
    icon?: JSX.Element | string;
    label: JSX.Element | string;
    value: JSX.Element | string;
    /** tints the icon chip (health, food, danger) */
    tone?: PaperRole;
    /** optional meter under the value */
    meter?: PaperStatTileMeter;
}

/**
 * A single metric readout: icon chip, value, label, optional meter. The
 * building block for player/plugin/world stat panels, so a panel never
 * hand-rolls a tile with its own CSS.
 */
export function PaperStatTile(props: PaperStatTileProps) {
    const [local, rest] = splitProps(props, [
        "icon",
        "label",
        "value",
        "tone",
        "meter",
        "class",
        "classList",
        "style",
    ]);

    const roleStyle = () =>
        isPaperRole(local.tone) ? roleVars(local.tone) : {};

    const className = () =>
        [styles.PaperStatTile, local.class].filter(Boolean).join(" ");

    const iconClass = () =>
        [styles.icon, isPaperRole(local.tone) ? styles.tone : ""]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={{ ...roleStyle(), ...(typeof local.style === "object" ? local.style : {}) }}
        >
            <Show when={local.icon}>
                <span class={iconClass()}>
                    {typeof local.icon === "string" ? (
                        <PaperIcon zeroHeight>{local.icon}</PaperIcon>
                    ) : (
                        local.icon
                    )}
                </span>
            </Show>
            <div class={styles.text}>
                <PaperText class={styles.value} size={5} weight={700}>
                    {local.value}
                </PaperText>
                <PaperText size={1} weight={500} color="text-subtle">
                    {local.label}
                </PaperText>
                <Show when={local.meter}>
                    <PaperProgress
                        class={styles.meter}
                        value={local.meter!.value}
                        max={local.meter!.max}
                        variant={local.meter!.variant ?? local.tone}
                    />
                </Show>
            </div>
        </div>
    );
}
