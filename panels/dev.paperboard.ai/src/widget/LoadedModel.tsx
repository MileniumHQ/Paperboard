// Loaded model (2x1): which model Ollama holds in memory, how much it takes,
// and a button that frees it. Polls only while the widget can be seen.

import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { PaperWidget, PaperWidgetMessage, PaperWidgetStat } from "@mileniumhq/paperui";
import type { WidgetContext } from "@mileniumhq/paperapi";
import { UI_ACTION_IDS, WIDGET_ACTION_IDS } from "../contract";
import { featuredLoaded, loadedDetail, runtimeBlocker } from "../core/widgets";
import type { LoadedModelsReport } from "../core/types";
import { HeaderAction, type WidgetAction } from "./HeaderAction";
import { errorText, useVisible, useWidgetService } from "./state";

const POLL_MS = 5_000;

export default function LoadedModel(props: { widget: WidgetContext }) {
    const service = useWidgetService();
    const visible = useVisible(props.widget);
    const [report, setReport] = createSignal<LoadedModelsReport | null>(null);
    const [readError, setReadError] = createSignal("");
    const [actionError, setActionError] = createSignal("");
    const [unloading, setUnloading] = createSignal(false);
    const [starting, setStarting] = createSignal(false);

    // one read in flight at a time; a result that lands after an unload
    // began is older than what the unload reports, so it is dropped
    let reading = false;
    let generation = 0;
    const read = async () => {
        if (reading || unloading()) return;
        reading = true;
        const mine = generation;
        try {
            const next = await service.call<LoadedModelsReport>(WIDGET_ACTION_IDS.loadedModels);
            if (mine !== generation) return;
            setReport(next);
            setReadError("");
        } catch (err) {
            if (mine !== generation) return;
            setReadError(errorText(err));
        } finally {
            reading = false;
        }
    };

    // poll while visible and the service has answered; a reply starting or
    // the runtime changing loads or drops a model, so read at once then too
    let timer: ReturnType<typeof setInterval> | undefined;
    createEffect(
        on(
            () => [visible(), service.hydration(), service.state.runtime.status, service.state.connections.length, service.state.generating.length] as const,
            ([isVisible, hydration]) => {
                clearInterval(timer);
                timer = undefined;
                if (!isVisible || hydration !== "ready") return;
                void read();
                timer = setInterval(() => void read(), POLL_MS);
            },
        ),
    );
    onCleanup(() => clearInterval(timer));

    const featured = () => {
        const r = report();
        return r?.status === "ok" ? featuredLoaded(r.models) : null;
    };

    const unload = async (name: string) => {
        setUnloading(true);
        setActionError("");
        generation++;
        try {
            setReport(await service.call<LoadedModelsReport>(WIDGET_ACTION_IDS.unloadModel, { model: name }));
            setReadError("");
        } catch (err) {
            setActionError(errorText(err));
        } finally {
            setUnloading(false);
        }
    };

    const start = async () => {
        setStarting(true);
        setActionError("");
        try {
            await service.call(UI_ACTION_IDS.startRuntime);
        } catch (err) {
            setActionError(errorText(err));
        } finally {
            setStarting(false);
        }
    };

    const blocker = () => runtimeBlocker(service.state.runtime.status, service.state.runtime.error);
    const retry: WidgetAction = { icon: "refresh", label: "Retry", run: () => void read() };
    const openAi: WidgetAction = { icon: "open_in_new", label: "Open AI", run: () => props.widget.openPanel() };

    // what the body says when there is no model to show, and the way out
    const view = (): { message?: { title: string; description?: string; danger?: boolean }; action?: WidgetAction } => {
        if (service.hydration() === "failed") {
            return { message: { title: "AI is not answering", danger: true }, action: { icon: "refresh", label: "Retry", run: () => void service.hydrate() } };
        }
        if (actionError()) {
            return { message: { title: "Could not unload", description: actionError(), danger: true }, action: { ...retry, run: () => { setActionError(""); void read(); } } };
        }
        if (readError()) return { message: { title: "Could not read memory", description: readError(), danger: true }, action: retry };
        const r = report();
        if (service.hydration() === "loading" || !r) return { message: { title: "Reading…" } };
        if (r.status === "unsupported") return { message: { title: "Not available", description: `${r.provider} can't report it.` }, action: openAi };
        if (r.status === "stopped") {
            const b = blocker();
            const action: WidgetAction | undefined =
                b?.recovery === "start"
                    ? { icon: "play_arrow", label: "Start Ollama", run: () => void start(), disabled: starting() }
                    : b?.recovery === "open"
                      ? openAi
                      : undefined;
            return { message: { title: b?.text ?? "Ollama is not ready", description: b?.detail, danger: b?.failed }, action };
        }
        const f = featured();
        if (f) {
            return {
                action: {
                    icon: "eject",
                    label: unloading() ? `Unloading ${f.model.name}` : `Unload ${f.model.name}`,
                    run: () => void unload(f.model.name),
                    disabled: unloading(),
                },
            };
        }
        return { message: { title: "Nothing in memory", description: "A chat loads a model when it replies." } };
    };

    return (
        <PaperWidget
            icon="memory"
            title="Loaded model"
            action={<Show when={view().action}>{(a) => <HeaderAction action={a()} />}</Show>}
        >
            <Show
                when={view().message}
                fallback={<Show when={featured()}>{(f) => <PaperWidgetStat
                            value={f().model.name}
                            // the header has no room left in a 2x1 tile; the count rides on the caption
                            caption={loadedDetail(f().model) + (f().others ? ` · +${f().others} more` : "")}
                        />}</Show>}
            >
                {(m) => <PaperWidgetMessage title={m().title} description={m().description} tone={m().danger ? "danger" : undefined} />}
            </Show>
        </PaperWidget>
    );
}
