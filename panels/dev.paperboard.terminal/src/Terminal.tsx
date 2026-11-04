import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { copyText, getVar, pasteText } from "@mileniumhq/paperui";
import { terminalApi, actions as actionsApi } from "@mileniumhq/paperapi";
import { terminalKeyAction } from "./keys";
import { errorMessage, type Outcome } from "./lib/failure";
import { joinScrollback } from "./lib/scrollback";
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

    onMount(() => {
        // the screen is the paper its active tab sits on
        const bg = token("surface-raised");
        const fg = token("text");
        const blue = token("primary");
        const red = token("danger");
        const green = token("success");
        const yellow = token("warning");
        const lightText = token("text-subtle");

        const term = new Terminal({
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
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef);
        activeTerminals.set(props.id, term);

        // the pty follows the screen: a resize the daemon refused is sent
        // again on the next fit instead of leaving the shell's wrapping wrong
        let sentCols = 0;
        let sentRows = 0;
        const fit = () => {
            // a hidden tab has no size to fit to; it fits when it is shown
            if (containerRef.clientWidth === 0 || containerRef.clientHeight === 0) return;
            fitAddon.fit();
            const { cols, rows } = term;
            if (cols === sentCols && rows === sentRows) return;
            terminalApi
                .resize(props.id, cols, rows)
                .then(() => {
                    sentCols = cols;
                    sentRows = rows;
                })
                .catch((err) => console.error(`[terminal] resize to ${cols}x${rows} for ${props.id} failed:`, err));
        };
        // fit before attach so the pty starts at its real size
        fit();
        // the cell size changes when the code font finishes loading
        document.fonts.ready.then(fit);
        const resizeObserver = new ResizeObserver(fit);
        resizeObserver.observe(containerRef);

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

        let disconnect: (() => void) | null = null;
        // the latest connect; an older one's late answer is ignored
        let attempt = 0;
        // set while the session is not usable: the next keypress opens it
        // again instead of typing into a shell that does not exist
        let stopped = false;
        const stop = (line: string, action: string) => {
            if (stopped) return;
            stopped = true;
            term.write(`\r\n\x1b[31m${line}\x1b[0m\r\n${action}\r\n`);
        };
        const connect = () => {
            const id = props.id;
            const current = ++attempt;
            stopped = false;
            disconnect?.();
            term.reset();
            // output that arrives while the scrollback is on its way waits
            // here, then joins it without repeating what the scrollback holds
            let pending: string[] | null = [];
            const offData = terminalApi.onData(id, (data) => {
                if (pending) pending.push(data);
                else term.write(data);
            });
            const offExit = terminalApi.onExit(id, (code) => {
                stop(`This shell exited${code ? ` with code ${code}` : ""}.`, "Press any key to start a new one.");
            });
            disconnect = () => {
                offData();
                offExit();
            };
            actionsApi
                .call<string>(TERMINAL_PANEL_ID, "open-tab", { id, cols: term.cols, rows: term.rows })
                .then((scrollback) => {
                    if (current !== attempt) return;
                    term.write(joinScrollback(scrollback, pending!));
                    pending = null;
                })
                .catch((err) => {
                    if (current !== attempt) return;
                    pending = null;
                    // the shell could not start, or the computer is unreachable
                    console.error("[terminal] could not open session:", err);
                    stop(`Could not open this terminal: ${errorMessage(err)}`, "Press any key to try again.");
                });
        };
        // a keystroke the daemon refused means the session is gone: say so,
        // and let the next key reconnect instead of typing into nothing
        const send = (data: string) => {
            if (stopped) {
                connect();
                return;
            }
            terminalApi.write(props.id, data).catch((err) => {
                console.error("[terminal] write failed:", err);
                stop(`Lost this terminal: ${errorMessage(err)}`, "Press any key to try again.");
            });
        };
        term.onData(send);

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
            send(text);
        };
        document.addEventListener("paste", onPaste);

        createEffect(on(() => props.id, connect));

        onCleanup(() => {
            document.removeEventListener("paste", onPaste);
            resizeObserver.disconnect();
            disconnect?.();
            activeTerminals.delete(props.id);
            // Sessions are service-owned and survive UI reloads; only the
            // local renderer is disposed here.
            term.dispose();
        });
    });

    // xterm measures its parent to fit, so the padding sits outside it
    return (
        <div
            class={styles.screen}
            onContextMenu={(e) => {
                e.preventDefault();
                props.onContextMenu?.(e);
            }}
        >
            <div ref={containerRef} class={styles.fit} />
        </div>
    );
}

export default TerminalComponent;
