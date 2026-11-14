import styles from "./index.module.css";
import { For, Show, children, createMemo, onCleanup, onMount, splitProps, type JSX, type ParentProps } from "solid-js";
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
 *   │ ◇ Title               detail ⋯ │  header: one line; a long title ends in "…"
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
 *
 * Nothing is cut: the detail shows whole or not at all, a stat's value
 * shrinks to fit its width, and a body too short for everything leaves out
 * stat captions and message descriptions, then stat meters, before a
 * value is made smaller to fit.
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
    const title = children(() => local.title);
    const icon = children(() => local.icon);
    const detail = children(() => local.detail);
    const action = children(() => local.action);
    const footer = children(() => local.footer);
    let body: HTMLDivElement | undefined;
    onMount(() => {
        if (!body || typeof ResizeObserver === "undefined") return;
        const el = body;
        const refit = () => fitBody(el);
        const resized = new ResizeObserver(refit);
        resized.observe(el);
        // a new reading changes what has to fit; the fitting itself only
        // sets attributes and styles, which are not watched
        const changed = new MutationObserver(refit);
        changed.observe(el, { childList: true, subtree: true, characterData: true });
        // a font arriving changes how wide and tall the same text is
        document.fonts?.addEventListener("loadingdone", refit);
        onCleanup(() => {
            resized.disconnect();
            changed.disconnect();
            document.fonts?.removeEventListener("loadingdone", refit);
        });
    });
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
                <Show when={title() !== undefined || detail() !== undefined || action()}>
                    <div class={styles.header}>
                        <Show when={icon()}>
                            {typeof icon() === "string" ? (
                                <PaperIcon class={styles.headerIcon} aria-hidden="true">{icon()}</PaperIcon>
                            ) : (
                                icon()
                            )}
                        </Show>
                        {/* a detail with no room beside the title wraps onto a
                            line the heading hides: whole, or not at all */}
                        <span class={styles.heading}>
                            <span class={styles.title}>{title()}</span>
                            <Show when={detail() !== undefined}>
                                <span class={styles.detail}>{detail()}</span>
                            </Show>
                        </span>
                        <Show when={action()}>
                            <span class={styles.headerAction}>{action()}</span>
                        </Show>
                    </div>
                </Show>
                <div ref={body} class={styles.body}>
                    {local.children}
                </div>
                <Show when={footer()}>
                    <div class={styles.footer}>{footer()}</div>
                </Show>
            </div>
        </div>
    );
}

/**
 * Fits a widget body's content to it without cutting anything. Each stat's
 * value takes the font size that fits its width (never larger than its
 * own). While the body overflows, it leaves out captions and message
 * descriptions, then meters and the second line of a message's title,
 * and last makes the values smaller still.
 */
function fitBody(body: HTMLElement) {
    const values = Array.from(body.querySelectorAll<HTMLElement>(`.${styles.statValue}`));
    delete body.dataset.tight;
    for (const value of values) value.style.removeProperty("--paper-widget-fit");
    for (const value of values) {
        if (value.scrollWidth > value.clientWidth && value.clientWidth > 0) {
            value.style.setProperty("--paper-widget-fit", String(value.clientWidth / value.scrollWidth));
        }
    }
    const overflows = () => body.scrollHeight > body.clientHeight;
    if (!overflows()) return;
    body.dataset.tight = "1";
    if (!overflows()) return;
    body.dataset.tight = "2";
    // line boxes round to whole pixels: a few passes settle it
    for (let pass = 0; pass < 3 && values.length > 0 && overflows(); pass++) {
        const shrink = body.clientHeight / body.scrollHeight;
        for (const value of values) {
            const fit = Number(value.style.getPropertyValue("--paper-widget-fit") || 1);
            value.style.setProperty("--paper-widget-fit", String(fit * shrink));
        }
    }
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
    const caption = children(() => local.caption);
    return (
        <div {...rest} class={[styles.stat, local.class].filter(Boolean).join(" ")} data-tone={local.tone} style={toneStyle(local.tone)}>
            <span class={styles.statValue}>{local.value}</span>
            <Show when={caption() !== undefined}>
                <span class={styles.statCaption}>{caption()}</span>
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
 * left out whole, never cut in half. A row is its id: a new rows array
 * (a poll's) keeps the element of every id it still has and updates what
 * it shows.
 */
export function PaperWidgetRows(props: PaperWidgetRowsProps) {
    const [local, rest] = splitProps(props, ["rows", "class"]);
    const byId = createMemo(() => {
        const rows = new Map<string, PaperWidgetRow>();
        for (const row of local.rows) {
            if (rows.has(row.id)) throw new Error(`PaperWidgetRows: two rows have the id "${row.id}"`);
            rows.set(row.id, row);
        }
        return rows;
    });
    const ids = createMemo(() => [...byId().keys()]);
    return (
        <ul {...rest} class={[styles.rows, local.class].filter(Boolean).join(" ")}>
            <For each={ids()}>
                {(id) => {
                    // a removed id's row is disposed right after this update;
                    // until then it keeps the last row it had
                    const row = createMemo<PaperWidgetRow>((last) => byId().get(id) ?? last, byId().get(id)!);
                    const label = children(() => row().label);
                    const detail = children(() => row().detail);
                    const content = () => (
                        <>
                            <Show when={row().tone}>
                                {(tone) => <span class={styles.dot} data-tone={tone()} style={toneStyle(tone())} aria-hidden="true" />}
                            </Show>
                            <span class={styles.rowLabel}>{label()}</span>
                            <Show when={detail() !== undefined}>
                                <span class={styles.rowDetail}>{detail()}</span>
                            </Show>
                        </>
                    );
                    return (
                        <li class={styles.row}>
                            <Show when={Boolean(row().onClick)} fallback={<div class={styles.rowInner}>{content()}</div>}>
                                <button type="button" class={styles.rowInner} aria-label={row().ariaLabel} onClick={() => row().onClick?.()}>
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
    /** the full reason as a tooltip, for a tile too small to show a description */
    hint?: string;
}

/**
 * Loading, empty, and failed states, in the body where the content would
 * be. Children are the way out: Retry, Open, Start. An alert when toned.
 */
export function PaperWidgetMessage(props: ParentProps<PaperWidgetMessageProps>) {
    const [local, rest] = splitProps(props, ["title", "description", "tone", "hint", "class", "children"]);
    const alert = () => local.tone === "danger" || local.tone === "warning";
    const description = children(() => local.description);
    const actions = children(() => local.children);
    return (
        <div
            role={alert() ? "alert" : "status"}
            {...rest}
            title={local.hint || undefined}
            class={[styles.message, local.class].filter(Boolean).join(" ")}
            data-tone={local.tone}
            style={toneStyle(local.tone)}
        >
            <span class={styles.messageTitle}>{local.title}</span>
            <Show when={description() !== undefined}>
                <span class={styles.messageDescription}>{description()}</span>
            </Show>
            <Show when={actions()}>
                <div class={styles.messageActions}>{actions()}</div>
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
