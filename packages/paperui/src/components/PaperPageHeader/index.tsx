import styles from "./index.module.css";
import {
    children,
    createEffect,
    createSignal,
    on,
    onCleanup,
    splitProps,
    Show,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { useSlidePageTitle } from "../../contexts/slidePage";

export interface PaperPageHeaderProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Icon glyph name or custom element shown in the leading chip. */
    icon?: JSX.Element | string;
    title: JSX.Element | string;
    subtitle?: JSX.Element | string;
    /** When the actions wrap under the title, center both rows. */
    centerWhenStacked?: boolean;
}

// One header for a page/tab body: a leading icon chip, title, subtitle, and
// trailing actions. Flat by design — a border and surface, no shadow — so
// it sits at the same depth as the content it introduces.
//
// In a phone layout's page whose bar already names it (PaperPanel's page,
// a PaperSlidePage) the header doesn't say the same title twice: it keeps
// only its subtitle and actions, and draws nothing when it has neither.
export function PaperPageHeader(props: ParentProps<PaperPageHeaderProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "title",
        "subtitle",
        "centerWhenStacked",
        "class",
        "classList",
        "children",
    ]);

    const icon = children(() => local.icon);
    const subtitle = children(() => local.subtitle);
    const actions = children(() => local.children);

    // the bar above already shows this title: the header leaves it, and the
    // icon that goes with it, to the bar
    const barTitle = useSlidePageTitle();
    const titleShown = () => {
        const bar = barTitle();
        return !(bar !== undefined && typeof local.title === "string" && sameTitle(bar, local.title));
    };
    const headingShown = () => titleShown() || Boolean(subtitle());

    let rootRef: HTMLDivElement | undefined;
    let headingRef: HTMLDivElement | undefined;
    let actionsRef: HTMLDivElement | undefined;
    // the actions have their own row under the heading (or there is no heading)
    const [stacked, setStacked] = createSignal(false);

    // flex-wrap leaves no trace CSS can select, so the row is measured:
    // actions that start below the heading have wrapped under it. Stacked
    // actions only grow to fill their row, which never changes where the row
    // wraps, so the measurement can't flip back and forth.
    createEffect(on([headingShown, actions], ([heading, shownActions]) => {
        if (!shownActions || !rootRef || typeof ResizeObserver === "undefined") {
            setStacked(!heading);
            return;
        }
        const measure = () =>
            setStacked(
                !heading ||
                    Boolean(
                        headingRef &&
                            actionsRef &&
                            actionsRef.offsetTop >= headingRef.offsetTop + headingRef.offsetHeight,
                    ),
            );
        const observer = new ResizeObserver(measure);
        observer.observe(rootRef);
        measure();
        onCleanup(() => observer.disconnect());
    }));

    return (
        <Show when={headingShown() || actions()}>
            <div
                {...rest}
                ref={(el) => {
                    rootRef = el;
                    if (typeof rest.ref === "function") rest.ref(el);
                }}
                class={[
                    styles.PaperPageHeader,
                    stacked() ? styles.stacked : "",
                    stacked() && local.centerWhenStacked ? styles.centered : "",
                    local.class,
                ]
                    .filter(Boolean)
                    .join(" ")}
                classList={local.classList}
            >
                <Show when={headingShown()}>
                    <div class={styles.heading} ref={headingRef}>
                        <Show when={titleShown() && icon()}>
                            <span class={styles.iconChip}>
                                {typeof icon() === "string" ? <PaperIcon>{icon()}</PaperIcon> : icon()}
                            </span>
                        </Show>
                        <div class={styles.text}>
                            <Show when={titleShown()}>
                                <PaperText preset="title" class={styles.title}>
                                    {local.title}
                                </PaperText>
                            </Show>
                            <Show when={subtitle()}>
                                <PaperText size={3} color="text-subtle">
                                    {subtitle()}
                                </PaperText>
                            </Show>
                        </div>
                    </div>
                </Show>

                <Show when={actions()}>
                    <div class={styles.actions} ref={actionsRef}>
                        {actions()}
                    </div>
                </Show>
            </div>
        </Show>
    );
}

/** the same title, as a person reads it: case and surrounding space aside */
function sameTitle(a: string, b: string): boolean {
    return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}
