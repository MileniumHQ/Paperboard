// Quick ask (4x1): a question box on Home. Sending starts a chat in the AI
// service, which asks the panel to open it, and then opens the panel.

import { createSignal, Show } from "solid-js";
import { PaperButton, PaperInput, PaperWidget, PaperWidgetMessage } from "@mileniumhq/paperui";
import type { WidgetContext } from "@mileniumhq/paperapi";
import { UI_ACTION_IDS, WIDGET_ACTION_IDS } from "../contract";
import { MAX_USER_MESSAGE_CHARS } from "../core/conversation";
import { quickAskBlocker, quickAskModel } from "../core/widgets";
import { HeaderAction, type WidgetAction } from "./HeaderAction";
import { errorText, useWidgetService } from "./state";
import styles from "./widgets.module.css";

export default function QuickAsk(props: { widget: WidgetContext }) {
    const service = useWidgetService();
    const [text, setText] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [sent, setSent] = createSignal(false);
    const [starting, setStarting] = createSignal(false);

    const ready = () => service.hydration() === "ready";
    // the model the widget was placed with; the default when it names none
    const chosen = () => props.widget.options.model;
    const blocker = () => (ready() ? quickAskBlocker(service.state, chosen()) : null);
    const model = () => quickAskModel(service.state, chosen());
    const canSend = () => ready() && !blocker() && !busy() && text().trim().length > 0;

    const submit = async (event: SubmitEvent) => {
        event.preventDefault();
        if (!canSend()) return;
        setBusy(true);
        setError("");
        setSent(false);
        try {
            await service.call(WIDGET_ACTION_IDS.quickAsk, { text: text(), ...(chosen() ? { model: chosen() } : {}) });
            setText("");
            setSent(true);
            props.widget.openPanel();
        } catch (err) {
            // the question stays in the box for the next try
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const start = async () => {
        setStarting(true);
        setError("");
        try {
            await service.call(UI_ACTION_IDS.startRuntime);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setStarting(false);
        }
    };

    // the body's message when the box can't be used, and the way out
    const view = (): { message: { title: string; description?: string; danger?: boolean }; action?: WidgetAction } | null => {
        if (service.hydration() === "loading") return { message: { title: "Connecting to AI…" } };
        if (service.hydration() === "failed") {
            return { message: { title: "AI is not answering", danger: true }, action: { icon: "refresh", label: "Retry", run: () => void service.hydrate() } };
        }
        const b = blocker();
        if (b) {
            const action: WidgetAction | undefined =
                b.recovery === "start"
                    ? { icon: "play_arrow", label: "Start Local AI", run: () => void start(), disabled: starting() }
                    : b.recovery === "open"
                      ? { icon: "open_in_new", label: "Open AI", run: () => props.widget.openPanel() }
                      : undefined;
            return error()
                ? { message: { title: "Could not start Local AI", description: error(), danger: true }, action }
                : { message: { title: b.text, description: b.detail, danger: b.failed }, action };
        }
        if (error()) {
            // the question is still in the box: back to it
            return { message: { title: "Not asked", description: error(), danger: true }, action: { icon: "edit", label: "Edit question", run: () => setError("") } };
        }
        return null;
    };

    return (
        <PaperWidget
            icon="smart_toy"
            title={ready() && model() ? `Ask ${model()}` : "Quick ask"}
            detail={sent() && !view() ? "Chat started" : undefined}
            action={<Show when={view()?.action}>{(a) => <HeaderAction action={a()} />}</Show>}
        >
            <Show
                when={view()}
                fallback={
                    <form class={styles.askRow} onSubmit={submit}>
                        <PaperInput
                            fullWidth
                            compact
                            aria-label={model() ? `Ask ${model()}` : "Ask AI"}
                            placeholder="Ask anything"
                            maxLength={MAX_USER_MESSAGE_CHARS}
                            value={text()}
                            onInput={(e) => {
                                setText(e.currentTarget.value);
                                setSent(false);
                            }}
                            disabled={busy()}
                        />
                        <PaperButton icon size="small" type="submit" variant="primary" aria-label="Ask" title="Ask" disabled={!canSend()}>
                            arrow_upward
                        </PaperButton>
                    </form>
                }
            >
                {(v) => <PaperWidgetMessage title={v().message.title} description={v().message.description} tone={v().message.danger ? "danger" : undefined} />}
            </Show>
        </PaperWidget>
    );
}
