import styles from "./index.module.css";
import { createMemo, splitProps, Show, type JSX } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperCode } from "../PaperCode";
import { PaperCollapsible } from "../PaperCollapsible";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { cx } from "../../utils/cx";
import { errorMessage } from "../../utils/errorMessage";
import { failureWords } from "../../utils/toasts";

export interface PaperErrorAction {
    label: string;
    onClick: () => void;
    /** Holds the button while what it started is still going, such as a read it repeats. */
    disabled?: boolean;
}

export interface PaperErrorProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** What failed, short: "Couldn't load the worlds". */
    title: string;
    /**
     * Why: whatever was caught (an Error, a string, anything), said in
     * words. Its first line is the reason; the lines after it fold under
     * Details.
     */
    error?: unknown;
    /** Anything longer, such as what a tool printed, folded under Details (default the error's other lines). */
    details?: string;
    /** One button under the reason: Try again, Open settings. */
    action?: PaperErrorAction;
    /**
     * Fills a view that has nothing else to show, centred in it. Without
     * it the error sits in line, in a section or above a list.
     */
    fill?: boolean;
    /**
     * It appeared because of what the person just did, so a screen reader
     * says it at once (role="alert"). Without it, it is a labelled region,
     * read when it is reached.
     */
    alert?: boolean;
}

/**
 * A failure that stands, said where it happens: a view that won't load, a
 * setup that failed, a service that refused. What failed, why, and what to
 * do about it. A one-off failure, such as a save, is a toast (showError).
 */
export function PaperError(props: PaperErrorProps) {
    const [local, rest] = splitProps(props, ["title", "error", "details", "action", "fill", "alert", "class", "classList"]);
    const words = createMemo(() => {
        const err = local.error;
        return err === undefined || err === null || err === "" ? { message: "" } : failureWords(errorMessage(err));
    });
    const details = () => local.details ?? words().details;

    return (
        <div
            {...rest}
            class={cx(styles.PaperError, local.fill ? styles.fill : styles.inline, local.class)}
            classList={local.classList}
            role={local.alert ? "alert" : "region"}
            aria-label={local.title}
            data-paper-error
        >
            <PaperIcon class={styles.icon} aria-hidden="true">error</PaperIcon>
            <div class={styles.body}>
                <PaperText preset="label" breakWord>
                    {local.title}
                </PaperText>
                <Show when={words().message}>
                    {(message) => (
                        <PaperText preset="hint" breakWord>
                            {message()}
                        </PaperText>
                    )}
                </Show>
                <Show when={local.action}>
                    {(action) => (
                        <div class={styles.actions}>
                            <PaperButton size={local.fill ? undefined : "small"} disabled={action().disabled} onClick={() => action().onClick()}>
                                {action().label}
                            </PaperButton>
                        </div>
                    )}
                </Show>
                <Show when={details()}>
                    {(text) => (
                        <PaperCollapsible title="Details" class={styles.details}>
                            <div class={styles.detailsText}>
                                <PaperCode block language="text">{text()}</PaperCode>
                            </div>
                        </PaperCollapsible>
                    )}
                </Show>
            </div>
        </div>
    );
}
