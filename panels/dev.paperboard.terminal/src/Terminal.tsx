import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { copyText, getVar, pasteText } from "@mileniumhq/paperui";
import { terminalApi, actions as actionsApi } from "@mileniumhq/paperapi";
import { terminalKeyAction } from "./keys";
import { errorMessage, type Outcome } from "./lib/failure";
import styles from "./Terminal.module.css";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export const activeTerminals = new Map<string, Terminal>();

// xterm paints a canvas, so it needs the theme's resolved values; a token
// that isn't defined is a broken stylesheet, not a reason to guess a color
function token(name: string): string {
    const value = getVar(name);
    if (!value) throw new Error(`PaperUI token --paper-${name} is not defined`);
    return value;
}

export async function copySelection(id: string) {
    const term = activeTerminals.get(id);
    const selection = term?.getSelection() || window.getSelection()?.toString() || "";
    if (!selection) return;
    // copyText owns the async-clipboard-plus-fallback path, same as PaperCopyButton
    if (!(await copyText(selection))) throw new Error("The clipboard refused the selection.");
}

export async function pasteClipboard(id: string) {
    // readText is denied unless the panel frame holds clipboard focus; the
    // context-menu click can leave focus on the menu, so focus the terminal
    // (and its helper textarea) before reading
    activeTerminals.get(id)?.focus();
    const text = await pasteText();
    // null is unavailable, "" is an empty clipboard: neither writes to the shell
    if (text === null) throw new Error("The clipboard couldn't be read here. Paste with the keyboard instead.");
    if (text) await terminalApi.write(id, text);
}

export interface TerminalComponentProps {
    id: string;
    onContextMenu?: (e: MouseEvent | PointerEvent) => void;
    /** a copy that failed, said where the panel can show it */
    onFailure: (failure: Outcome) => void;
}

export function TerminalComponent(props: TerminalComponentProps) {
    let containerRef!: HTMLDivElement;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;

    onMount(() => {
        document.fonts?.ready?.then(() => safeFit()).catch((err) => {
            console.debug("[terminal] font-ready fit failed:", String(err));
        });

        const bg = token("surface-app");
        const fg = token("text");
        const blue = token("primary");
        const red = token("danger");
        const green = token("success");
        const yellow = token("warning");
        const lightText = token("text-subtle");

        term = new Terminal({
            fontFamily: token("font-family-code"),
            fontSize: Number.parseFloat(token("text-size-2")),
            cursorBlink: true,
            theme: {
                background: bg,
                foreground: fg,
                cursor: blue,
                selectionBackground: token("selection"),
                black: token("surface-sunken"),
                red,
                green,
                yellow,
                blue,
                white: fg,
                brightBlack: lightText,
                brightRed: red,
                brightGreen: green,
                brightYellow: yellow,
                brightBlue: blue,
                brightWhite: fg,
            },
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(containerRef);
        activeTerminals.set(props.id, term);

        // fit before attach so the pty starts at real size, not 80x24
        let lastCols = -1;
        let lastRows = -1;
        const sendResize = () => {
            if (!term) return;
            if (term.cols === lastCols && term.rows === lastRows) return;
            const cols = term.cols;
            const rows = term.rows;
            // the sent size is recorded only on success: a failed send
            // (daemon unreachable, session gone) must retry on the next
            // fit instead of desyncing the shell's line wrapping forever
            terminalApi
                .resize(props.id, cols, rows)
                .then(() => {
                    lastCols = cols;
                    lastRows = rows;
                })
                .catch((err) => {
                    console.error(
                        `[terminal] resize to ${cols}x${rows} for ${props.id} failed, will retry:`,
                        err,
                    );
                });
        };
        const safeFit = () => {
            if (
                fitAddon &&
                containerRef &&
                containerRef.clientWidth > 50 &&
                containerRef.clientHeight > 50
            ) {
                try {
                    fitAddon.fit();
                    sendResize();
                } catch (err) {
                    console.debug("[terminal] fit/resize failed:", String(err));
                }
            }
        };
        safeFit();

        term.attachCustomKeyEventHandler((arg) => {
            // paste is left to the native paste event (see keys.ts)
            if (terminalKeyAction(arg) === "copy") {
                copySelection(props.id).catch((err) =>
                    props.onFailure({ title: "Nothing copied", message: errorMessage(err) }),
                );
                return false;
            }
            return true;
        });

        let disconnectData: (() => void) | null = null;
        // set while the session could not be opened: the next keypress
        // retries instead of typing into a shell that does not exist
        let failedId: string | null = null;
        const fail = (id: string, line: string) => {
            if (props.id !== id || failedId === id) return;
            failedId = id;
            term?.write(`\x1b[31m${line}\x1b[0m\r\n` + "Press any key to try again.\r\n");
        };
        // a keystroke the daemon refused means the session is gone: say so,
        // and let the next key reconnect instead of typing into nothing
        const send = (data: string) => {
            const id = props.id;
            terminalApi.write(id, data).catch((err) => {
                console.error("[terminal] write failed:", err);
                fail(id, `Lost this terminal: ${errorMessage(err)}`);
            });
        };
        term.onData((data) => {
            if (failedId !== null) {
                connect(failedId);
                return;
            }
            send(data);
        });

        // A native paste with focus outside xterm (for example the context
        // menu item) never reaches xterm's own paste listener. Route it here,
        // but let xterm own pastes inside its element so nothing is written
        // twice.
        const onPaste = (ev: ClipboardEvent) => {
            // every tab stays mounted; only the visible terminal may answer a
            // paste delivered outside xterm, or a hidden one would also write
            if (containerRef.getClientRects().length === 0) return;
            if (containerRef.contains(ev.target as Node | null)) return;
            const text = ev.clipboardData?.getData("text/plain");
            if (!text) return;
            ev.preventDefault();
            if (failedId !== null) {
                connect(failedId);
                return;
            }
            send(text);
        };
        document.addEventListener("paste", onPaste);

        const connect = (id: string) => {
            failedId = null;
            disconnectData?.();
            term?.clear();
            disconnectData = terminalApi.onData(id, (data) => term?.write(data));
            actionsApi
                .call<string>(TERMINAL_PANEL_ID, "open-tab", {
                    id,
                    cols: term?.cols,
                    rows: term?.rows,
                })
                .then((scrollback) => {
                    if (scrollback) term?.write(scrollback);
                })
                .catch((err) => {
                    // the session's shell could not start (or the computer
                    // is unreachable): say so in the terminal itself
                    console.error("[terminal] could not open session:", err);
                    fail(id, `Could not open this terminal: ${errorMessage(err)}`);
                });
        };
        createEffect(
            on(
                () => props.id,
                (id) => connect(id),
            ),
        );

        requestAnimationFrame(() => safeFit());
        setTimeout(safeFit, 100);

        resizeObserver = new ResizeObserver(() => safeFit());
        resizeObserver.observe(containerRef);

        onCleanup(() => {
            document.removeEventListener("paste", onPaste);
            if (resizeObserver) resizeObserver.disconnect();
            disconnectData?.();
            activeTerminals.delete(props.id);
            // Sessions are service-owned and survive UI reloads; only the
            // local renderer is disposed here.
            if (term) term.dispose();
        });
    });

    return (
        <div
            ref={containerRef}
            onContextMenu={(e) => {
                e.preventDefault();
                props.onContextMenu?.(e);
            }}
            class={styles.screen}
        />
    );
}

export default TerminalComponent;
