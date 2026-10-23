// One of the computer's windows, live: frames are polled only while the tab
// is shown (one request in flight, unchanged frames skipped by hash), and
// with control the pointer and keyboard go to the window.

import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperLoader } from "@mileniumhq/paperui";
import type { ComputerWindow, InputEvent } from "../contract";
import type { Agent } from "../lib/agent";
import { enqueue, keyEvent } from "./input";
import styles from "./WindowView.module.css";

// how often a shown window is asked for a new frame: brisk while the user drives, calm while they watch
const DRIVING_MS = 80;
const WATCHING_MS = 400;
const HIDDEN_MS = 1000;

const BUTTONS: Record<number, 1 | 2 | 3> = { 0: 1, 1: 2, 2: 3 };

export function WindowView(props: {
    agent: Agent;
    window: ComputerWindow;
    active: boolean;
    /** this shell holds control */
    holding: boolean;
    onTakeControl: () => void;
    onHandBack: () => void;
    controlBusy: boolean;
}) {
    const [src, setSrc] = createSignal<string | null>(null);
    const [size, setSize] = createSignal({ width: props.window.width, height: props.window.height });
    const [error, setError] = createSignal<string | null>(null);
    const [inputError, setInputError] = createSignal<string | null>(null);
    let img: HTMLImageElement | undefined;
    let hash: string | null = null;
    let polling = false;
    let disposed = false;
    let wake: (() => void) | null = null;
    onCleanup(() => {
        disposed = true;
        wake?.();
    });

    const nap = (ms: number) =>
        new Promise<void>((ok) => {
            const t = setTimeout(done, ms);
            function done() {
                clearTimeout(t);
                wake = null;
                ok();
            }
            wake = done;
        });

    const showing = () => props.active && props.agent.state.computer.phase === "ready" && !error();

    async function poll() {
        if (polling) return;
        polling = true;
        try {
            while (!disposed && showing()) {
                if (document.hidden) {
                    await nap(HIDDEN_MS);
                    continue;
                }
                const f = await props.agent.frame(props.window.id, hash);
                if (!f.same) {
                    hash = f.hash;
                    setSrc(`data:image/jpeg;base64,${f.frame}`);
                    setSize({ width: f.width, height: f.height });
                }
                await nap(props.holding ? DRIVING_MS : WATCHING_MS);
            }
        } catch (e) {
            if (!disposed) setError(e instanceof Error ? e.message : String(e));
        } finally {
            polling = false;
        }
    }
    createEffect(on(showing, (on) => on && void poll()));

    // ------------------------------------------------------------- input

    let pending: InputEvent[] = [];
    let sending = false;
    const send = (ev: InputEvent) => {
        if (!props.holding) return;
        if (!enqueue(pending, ev)) {
            setInputError("Too much input at once; some was dropped.");
            return;
        }
        void flush();
    };
    async function flush() {
        if (sending) return;
        sending = true;
        try {
            while (pending.length && !disposed) {
                const batch = pending;
                pending = [];
                await props.agent.input(props.window.id, batch);
                setInputError(null);
                wake?.(); // show what it did without waiting out the nap
            }
        } catch (e) {
            pending = [];
            setInputError(e instanceof Error ? e.message : String(e));
        } finally {
            sending = false;
        }
    }

    /** a pointer position in the window's own pixels */
    const point = (e: MouseEvent) => {
        const r = img!.getBoundingClientRect();
        const s = size();
        const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
        return { x: clamp(((e.clientX - r.left) * s.width) / r.width, s.width), y: clamp(((e.clientY - r.top) * s.height) / r.height, s.height) };
    };

    return (
        <div class={styles.view}>
            <div class={styles.bar}>
                <span class={styles.title}>{props.window.title || props.window.app}</span>
                <Show when={inputError()}>
                    <span class={styles.inputError} role="alert">
                        {inputError()}
                    </span>
                </Show>
                <Show
                    when={props.holding}
                    fallback={
                        <PaperButton size="small" disabled={props.controlBusy || props.agent.state.computer.phase !== "ready"} onClick={props.onTakeControl}>
                            <PaperIcon>pan_tool</PaperIcon> Take control
                        </PaperButton>
                    }
                >
                    <PaperButton size="small" variant="primary" disabled={props.controlBusy} onClick={props.onHandBack}>
                        <PaperIcon>back_hand</PaperIcon> Hand back
                    </PaperButton>
                </Show>
            </div>

            <div class={styles.stage}>
                <Show
                    when={!error()}
                    fallback={
                        <PaperEmptyState icon="broken_image" title="Couldn't show this window" description={error() ?? undefined}>
                            <PaperButton
                                onClick={() => {
                                    hash = null;
                                    setError(null);
                                }}
                            >
                                Try again
                            </PaperButton>
                        </PaperEmptyState>
                    }
                >
                    <Show when={src()} fallback={<PaperLoader loaderStatus="indeterminate" label="Looking" />}>
                        <img
                            ref={img}
                            class={styles.frame}
                            classList={{ [styles.driving!]: props.holding }}
                            src={src()!}
                            alt={`${props.window.title || props.window.app}${props.holding ? ", under your control" : ", as the computer shows it"}`}
                            draggable={false}
                            tabindex={props.holding ? 0 : -1}
                            onPointerDown={(e) => {
                                if (!props.holding) return;
                                e.preventDefault();
                                img!.focus();
                                img!.setPointerCapture(e.pointerId);
                                const button = BUTTONS[e.button];
                                if (button) send({ type: "down", button, ...point(e) });
                            }}
                            onPointerUp={(e) => {
                                const button = BUTTONS[e.button];
                                if (button) send({ type: "up", button, ...point(e) });
                            }}
                            onPointerMove={(e) => send({ type: "move", ...point(e) })}
                            onWheel={(e) => {
                                if (!props.holding) return;
                                e.preventDefault();
                                send({ type: "scroll", ...point(e), dy: Math.sign(e.deltaY), dx: Math.sign(e.deltaX) });
                            }}
                            onContextMenu={(e) => props.holding && e.preventDefault()}
                            onKeyDown={(e) => {
                                if (!props.holding || e.isComposing) return;
                                const ev = keyEvent(e);
                                if (!ev) return;
                                e.preventDefault();
                                send(ev);
                            }}
                        />
                    </Show>
                </Show>
            </div>
        </div>
    );
}
