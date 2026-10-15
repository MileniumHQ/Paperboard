import styles from "./index.module.css";
import { For, Show, splitProps, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../../components/PaperIcon";
import { PaperProgress } from "../../components/PaperProgress";
import type { PaperRole } from "../../types";
import { isPaperRole, roleVars } from "../../utils/colors";

// a role colors through --role-base; "none" and no tone fall back to text
const toneStyle = (tone: PaperRole | "none" | undefined): JSX.CSSProperties | undefined =>
    isPaperRole(tone) ? { ...roleVars(tone) } : undefined;

/**
 * One Home widget, laid out the same way as every other:
 *
 *   ┌───────────────────────────────┐
 *   │ ◇ Title               detail ⋯ │  header: one line, always on top
 *   │                               │
 *   │ body: a stat, rows, a chart,  │  everything starts at the same
 *   │ or a message                  │  left edge as the title
 *   │                               │
 *   │ meta                  [Action]│  footer: optional, on the bottom edge
 *   └───────────────────────────────┘
 *
 * It fills its tile and sizes padding and type from the tile, so the same
 * widget reads the same on the smallest cell and the largest. Compose the
 * body from PaperWidgetStat, PaperWidgetRows and PaperWidgetMessage
 * rather than hand-rolled CSS, so widgets from different panels line up.
 */
export interface PaperWidgetProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** the header's title; omit only for a widget that is a face, like a clock */
    title?: JSX.Element | string;
    /** a Material Symbols name, or an element, before the title */
    icon?: JSX.Element | string;
    /** muted text at the header's end: a count, a unit, a time */
    detail?: JSX.Element | string;
    /** one compact control at the header's end, after the detail */
    action?: JSX.Element;
    /** the bottom row: meta text on the left, actions on the right */
    footer?: JSX.Element;
    /**
     * Makes the whole tile one button, for a one-cell widget with no room in
     * its header for a control. Controls inside the tile still work on their own.
     */
    onPress?: () => void;
    /** the pressed tile's accessible name; required with onPress */
    pressLabel?: string;
    pressDisabled?: boolean;
}

export function PaperWidget(props: ParentProps<PaperWidgetProps>) {
    const [local, rest] = splitProps(props, ["title", "icon", "detail", "action", "footer", "onPress", "pressLabel", "pressDisabled", "class", "classList", "children"]);
    return (
        <div {...rest} class={[styles.PaperWidget, local.class].filter(Boolean).join(" ")} classList={local.classList} data-pressable={local.onPress ? "" : undefined}>
            <Show when={local.onPress}>
                <button
                    type="button"
                    class={styles.press}
                    aria-label={local.pressLabel}
                    title={local.pressLabel}
                    disabled={local.pressDisabled}
                    onClick={() => local.onPress?.()}
                />
            </Show>
            <div class={styles.layout}>
                <Show when={local.title !== undefined || local.detail !== undefined || local.action}>
                    <div class={styles.header}>
                        <Show when={local.icon}>
                            {typeof local.icon === "string" ? (
                                <PaperIcon class={styles.headerIcon} aria-hidden="true">{local.icon}</PaperIcon>
                            ) : (
                                local.icon
                            )}
                        </Show>
                        <span class={styles.title}>{local.title}</span>
                        <Show when={local.detail !== undefined}>
                            <span class={styles.detail}>{local.detail}</span>
                        </Show>
                        <Show when={local.action}>
                            <span class={styles.headerAction}>{local.action}</span>
                        </Show>
                    </div>
                </Show>
                <div class={styles.body}>{local.children}</div>
                <Show when={local.footer}>
                    <div class={styles.footer}>{local.footer}</div>
                </Show>
            </div>
        </div>
    );
}

export interface PaperWidgetStatMeter {
    value: number;
    max: number;
    /** defaults to the stat's tone, or primary */
    variant?: PaperRole;
}

export interface PaperWidgetStatProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value: JSX.Element | string;
    /** a line under the value saying what it is */
    caption?: JSX.Element | string;
    /** colors the value: success, danger, warning */
    tone?: PaperRole;
    /** a bar under the caption */
    meter?: PaperWidgetStatMeter;
}

/** The figure a widget is about: large, left-aligned, sized by the tile. */
export function PaperWidgetStat(props: PaperWidgetStatProps) {
    const [local, rest] = splitProps(props, ["value", "caption", "tone", "meter", "class"]);
    return (
        <div {...rest} class={[styles.stat, local.class].filter(Boolean).join(" ")} data-tone={local.tone} style={toneStyle(local.tone)}>
            <span class={styles.statValue}>{local.value}</span>
            <Show when={local.caption !== undefined}>
                <span class={styles.statCaption}>{local.caption}</span>
            </Show>
            <Show when={local.meter}>
                {(meter) => (
                    <PaperProgress
                        class={styles.statMeter}
                        value={meter().value}
                        max={meter().max}
                        variant={meter().variant ?? local.tone ?? "primary"}
                    />
                )}
            </Show>
        </div>
    );
}

/** Stats side by side, sharing the body's width equally. */
export function PaperWidgetStats(props: ParentProps<JSX.HTMLAttributes<HTMLDivElement>>) {
    const [local, rest] = splitProps(props, ["class", "children"]);
    return (
        <div {...rest} class={[styles.stats, local.class].filter(Boolean).join(" ")}>
            {local.children}
        </div>
    );
}

export interface PaperWidgetRow {
    /** stable identity for the row */
    id: string;
    label: JSX.Element | string;
    detail?: JSX.Element | string;
    /** a status dot before the label; "none" draws a hollow one */
    tone?: PaperRole | "none";
    /** an accessible name when the row is a button */
    ariaLabel?: string;
    onClick?: () => void;
}

export interface PaperWidgetRowsProps extends Omit<JSX.HTMLAttributes<HTMLUListElement>, "children"> {
    rows: PaperWidgetRow[];
}

/**
 * A list of rows: dot, label, detail. Rows that don't fit the tile are
 * left out whole, never cut in half.
 */
export function PaperWidgetRows(props: PaperWidgetRowsProps) {
    const [local, rest] = splitProps(props, ["rows", "class"]);
    return (
        <ul {...rest} class={[styles.rows, local.class].filter(Boolean).join(" ")}>
            <For each={local.rows}>
                {(row) => {
                    const content = () => (
                        <>
                            <Show when={row.tone}>
                                <span class={styles.dot} data-tone={row.tone} style={toneStyle(row.tone)} aria-hidden="true" />
                            </Show>
                            <span class={styles.rowLabel}>{row.label}</span>
                            <Show when={row.detail !== undefined}>
                                <span class={styles.rowDetail}>{row.detail}</span>
                            </Show>
                        </>
                    );
                    return (
                        <li class={styles.row}>
                            <Show when={row.onClick} fallback={<div class={styles.rowInner}>{content()}</div>}>
                                <button type="button" class={styles.rowInner} aria-label={row.ariaLabel} onClick={() => row.onClick?.()}>
                                    {content()}
                                </button>
                            </Show>
                        </li>
                    );
                }}
            </For>
        </ul>
    );
}

export interface PaperWidgetMessageProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** what is happening, in a few words */
    title: JSX.Element | string;
    /** why, or what to do */
    description?: JSX.Element | string;
    /** danger and warning mark a failure; omit for an empty or loading state */
    tone?: PaperRole;
}

/**
 * Loading, empty, and failed states, in the body where the content would
 * be. Children are the way out: Retry, Open, Start. An alert when toned.
 */
export function PaperWidgetMessage(props: ParentProps<PaperWidgetMessageProps>) {
    const [local, rest] = splitProps(props, ["title", "description", "tone", "class", "children"]);
    const alert = () => local.tone === "danger" || local.tone === "warning";
    return (
        <div
            role={alert() ? "alert" : "status"}
            {...rest}
            class={[styles.message, local.class].filter(Boolean).join(" ")}
            data-tone={local.tone}
            style={toneStyle(local.tone)}
        >
            <span class={styles.messageTitle}>{local.title}</span>
            <Show when={local.description !== undefined}>
                <span class={styles.messageDescription}>{local.description}</span>
            </Show>
            <Show when={local.children}>
                <div class={styles.messageActions}>{local.children}</div>
            </Show>
        </div>
    );
}

/** A status dot on its own, for a header or a footer line. */
export function PaperWidgetDot(props: { tone?: PaperRole | "none"; class?: string }) {
    return (
        <span
            class={[styles.dot, props.class].filter(Boolean).join(" ")}
            data-tone={props.tone ?? "none"}
            style={toneStyle(props.tone)}
            aria-hidden="true"
        />
    );
}
