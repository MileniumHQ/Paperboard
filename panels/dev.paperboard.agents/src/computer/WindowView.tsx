// One of the computer's windows, live: frames are polled while its tab is
// shown (one request in flight, unchanged frames skipped by hash, slower
// while the shell is in the background). Clicking, scrolling or typing in it,
// going somewhere from its address bar, or answering a dialog the page shows
// takes control of the computer first (onUse), and the input follows.

import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { ComputerWindow, InputEvent, PageDialog } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText, failure, type Failure } from "../lib/failure";
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
    /** the user is using the computer: resolves once this shell holds control */
    onUse: () => Promise<void>;
}) {
    const [src, setSrc] = createSignal<string | null>(null);
    const [size, setSize] = createSignal({ width: props.window.width, height: props.window.height });
    const [error, setError] = createSignal<string | null>(null);
    const [inputError, setInputError] = createSignal<Failure | null>(null);
    const [dialog, setDialog] = createSignal<PageDialog | null>(null);
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
                setDialog(f.dialog);
                if (!f.same) {
                    hash = f.hash;
                    setSrc(`data:image/jpeg;base64,${f.frame}`);
                    setSize({ width: f.width, height: f.height });
                }
                await nap(props.holding ? DRIVING_MS : WATCHING_MS);
            }
        } catch (e) {
            if (!disposed) setError(errorText(e));
        } finally {
            polling = false;
        }
    }
    createEffect(on(showing, (on) => on && void poll()));

    // ------------------------------------------------------------- input

    let pending: InputEvent[] = [];
    let sending = false;
    /** `takes`: a click, scroll or key, which takes control; the pointer only moving doesn't */
    const send = (ev: InputEvent, takes = false) => {
        if (!props.holding && !takes) return;
        if (!enqueue(pending, ev)) {
            setInputError({ title: "Input dropped", message: "Too much input at once; some of it didn't reach the window." });
            return;
        }
        void flush();
    };
    async function flush() {
        if (sending) return;
        sending = true;
        try {
            while (pending.length && !disposed) {
                await props.onUse();
                const batch = pending;
                pending = [];
                await props.agent.input(props.window.id, batch);
                setInputError(null);
                wake?.(); // show what it did without waiting out the nap
            }
        } catch (e) {
            pending = [];
            setInputError(failure("Input not sent", e));
        } finally {
            sending = false;
        }
    }

    // ------------------------------------------------------------- the on-screen keyboard

    // A touch screen has no keyboard until a field has focus, and the window's picture isn't a field: so a hidden
    // one is, and what it receives is sent on. It always holds a zero-width mark, so a Backspace on a phone
    // (which reports no key, only an input) has something to delete and shows up as the mark going missing.
    const MARK = "\u200b";
    const touch = matchMedia("(pointer: coarse)");
    const [touching, setTouching] = createSignal(touch.matches);
    const watchTouch = () => setTouching(touch.matches);
    touch.addEventListener("change", watchTouch);
    onCleanup(() => touch.removeEventListener("change", watchTouch));
    const [keyboard, setKeyboard] = createSignal(false);
    let keys: HTMLInputElement | undefined;
    const rest = () => {
        keys!.value = MARK;
        keys!.setSelectionRange(MARK.length, MARK.length);
    };
    // typed text, or a Backspace, since the field was last at rest
    const readKeys = () => {
        const typed = keys!.value.replaceAll(MARK, "");
        const erased = !keys!.value.includes(MARK);
        rest();
        if (erased) send({ type: "key", keys: "BackSpace" }, true);
        if (typed) send({ type: "text", text: typed }, true);
    };
    // the button raises the keyboard and lowers it; it has to be the tap itself that focuses the field, or a phone refuses
    const toggleKeyboard = () => (keyboard() ? keys!.blur() : keys!.focus());

    // ------------------------------------------------------------- the address bar and dialogs

    const [address, setAddress] = createSignal<string | null>(null);
    // the address as typed until it's sent; the page's own address otherwise
    createEffect(on(() => props.window.url, () => setAddress(null), { defer: true }));
    const shownAddress = () => address() ?? (props.window.url === "about:blank" ? "" : props.window.url);
    const go = async (to: string) => {
        try {
            await props.onUse();
            await props.agent.go(props.window.id, to);
            setAddress(null);
            setInputError(null);
            wake?.();
        } catch (e) {
            setInputError(failure("Page not opened", e));
        }
    };
    const [answer, setAnswer] = createSignal("");
    const reply = (accept: boolean) => {
        const d = dialog();
        if (!d) return;
        // a prompt's answer is typed into it; anything else is accepted with Return or dismissed with Escape
        send(accept && d.type === "prompt" ? { type: "text", text: answer() } : { type: "key", keys: accept ? "Return" : "Escape" }, true);
        setAnswer("");
    };

    /** a pointer position in the window's own pixels */
    const point = (e: MouseEvent) => {
        const r = img!.getBoundingClientRect();
        const s = size();
        const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
        return { x: clamp(((e.clientX - r.left) * s.width) / r.width, s.width), y: clamp(((e.clientY - r.top) * s.height) / r.height, s.height) };
    };

    return (
        <div class={styles.view}>
            <form
                class={styles.bar}
                aria-label="Address bar"
                onSubmit={(e) => {
                    e.preventDefault();
                    const to = shownAddress().trim();
                    if (to) void go(to);
                }}
            >
                <PaperButton icon size="small" variant="text" type="button" aria-label="Back" title="Back" onClick={() => void go("back")}>
                    <PaperIcon>arrow_back</PaperIcon>
                </PaperButton>
                <PaperButton icon size="small" variant="text" type="button" aria-label="Forward" title="Forward" onClick={() => void go("forward")}>
                    <PaperIcon>arrow_forward</PaperIcon>
                </PaperButton>
                <PaperButton icon size="small" variant="text" type="button" aria-label="Reload" title="Reload" onClick={() => void go("reload")}>
                    <PaperIcon>refresh</PaperIcon>
                </PaperButton>
                <PaperInput
                    class={styles.address}
                    name="address"
                    aria-label="Address"
                    compact
                    placeholder="Type a web address"
                    value={shownAddress()}
                    maxLength={2048}
                    onInput={(e) => setAddress(e.currentTarget.value)}
                />
                <Show when={touching()}>
                    <PaperButton
                        icon
                        size="small"
                        variant={keyboard() ? "primary" : "text"}
                        type="button"
                        aria-label={keyboard() ? "Hide keyboard" : "Show keyboard"}
                        aria-pressed={keyboard()}
                        title={keyboard() ? "Hide keyboard" : "Show keyboard"}
                        // a tap on the button mustn't take focus off the field it just gave it to
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={toggleKeyboard}
                    >
                        <PaperIcon>keyboard</PaperIcon>
                    </PaperButton>
                </Show>
            </form>
            <Show when={dialog()}>
                {(d) => (
                    <form
                        class={styles.dialog}
                        role="alertdialog"
                        aria-label={d().type === "beforeunload" ? "The page asks whether to leave it" : "The page asks"}
                        onSubmit={(e) => {
                            e.preventDefault();
                            reply(true);
                        }}
                    >
                        <PaperText preset="text">{d().type === "beforeunload" ? "Leave this page? Changes you made may not be saved." : d().message || "The page is waiting."}</PaperText>
                        <Show when={d().type === "prompt"}>
                            <PaperInput compact name="answer" aria-label="Answer" value={answer()} maxLength={2000} onInput={(e) => setAnswer(e.currentTarget.value)} />
                        </Show>
                        <div class={styles.dialogActions}>
                            <Show when={d().type !== "alert"}>
                                <PaperButton size="small" variant="text" type="button" onClick={() => reply(false)}>
                                    {d().type === "beforeunload" ? "Stay" : "Cancel"}
                                </PaperButton>
                            </Show>
                            <PaperButton size="small" variant="primary" type="submit">
                                {d().type === "beforeunload" ? "Leave" : "OK"}
                            </PaperButton>
                        </div>
                    </form>
                )}
            </Show>
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
                            tabindex={0}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                // the keyboard stays up for the next tap
                                if (keyboard()) keys!.focus();
                                else img!.focus();
                                img!.setPointerCapture(e.pointerId);
                                const button = BUTTONS[e.button];
                                if (button) send({ type: "down", button, ...point(e) }, true);
                            }}
                            onPointerUp={(e) => {
                                const button = BUTTONS[e.button];
                                if (button) send({ type: "up", button, ...point(e) }, true);
                            }}
                            onPointerMove={(e) => send({ type: "move", ...point(e) })}
                            onWheel={(e) => {
                                e.preventDefault();
                                send({ type: "scroll", ...point(e), dy: Math.sign(e.deltaY), dx: Math.sign(e.deltaX) }, true);
                            }}
                            // the right button belongs to the window
                            onContextMenu={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                                if (e.isComposing) return;
                                const ev = keyEvent(e);
                                if (!ev) return;
                                e.preventDefault();
                                send(ev, true);
                            }}
                        />
                    </Show>
                </Show>
            </div>
            <input
                ref={keys}
                class={styles.keys}
                type="text"
                aria-label="Keyboard input for the window"
                tabindex={-1}
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
                enterkeyhint="enter"
                value={MARK}
                onFocus={() => {
                    rest();
                    setKeyboard(true);
                }}
                onBlur={() => setKeyboard(false)}
                // Enter and the keys that aren't text are named here; plain characters arrive as input
                onKeyDown={(e) => {
                    if (e.isComposing || e.keyCode === 229) return;
                    const ev = keyEvent(e);
                    if (!ev || ev.type === "text") return;
                    e.preventDefault();
                    send(ev, true);
                }}
                // a phone's Enter and Backspace may come as an input and no key
                onBeforeInput={(e) => {
                    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
                        e.preventDefault();
                        send({ type: "key", keys: "Return" }, true);
                    } else if (e.inputType === "deleteContentBackward" && !e.isComposing) {
                        e.preventDefault();
                        send({ type: "key", keys: "BackSpace" }, true);
                    }
                }}
                onInput={(e) => !e.isComposing && readKeys()}
                onCompositionEnd={readKeys}
            />
            <Show when={inputError()}>
                {(shown) => (
                    <PaperFlex paddingX="full" paddingY="half">
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setInputError(null)}>
                            {shown().message}
                        </PaperQuote>
                    </PaperFlex>
                )}
            </Show>
        </div>
    );
}
