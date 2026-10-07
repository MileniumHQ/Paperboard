import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { copyText, getVar, getVarCss, pasteText } from "@mileniumhq/paperui";
import { terminalApi, actions as actionsApi } from "@mileniumhq/paperapi";
import { terminalKeyAction } from "./keys";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export const activeTerminals = new Map<string, Terminal>();

export async function copySelection(id: string) {
    const term = activeTerminals.get(id);
    const selection = term?.getSelection() || window.getSelection()?.toString() || "";
    if (!selection) return;
    // copyText owns the async-clipboard-plus-fallback path, same as PaperCopyButton
    const ok = await copyText(selection);
    if (!ok) console.error(`[Terminal] copy failed for ${id}`);
}

export async function pasteClipboard(id: string) {
    // readText is denied unless the panel frame holds clipboard focus; the
    // context-menu click can leave focus on the menu, so focus the terminal
    // (and its helper textarea) before reading
    activeTerminals.get(id)?.focus();
    const text = await pasteText();
    // null is unavailable, "" is an empty clipboard: neither writes to the shell
    if (text === null) {
        console.error(`[Terminal] paste unavailable for ${id}`);
        return;
    }
    if (text) terminalApi.write(id, text);
}

export interface TerminalComponentProps {
    id: string;
    onContextMenu?: (e: MouseEvent | PointerEvent) => void;
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

        const bg = getVar("surface-app", "#0d0e12");
        const fg = getVar("text", "#ffffff");
        const blue = getVar("primary", "#2981e5");
        const red = getVar("danger", "#e73648");
        const green = getVar("success", "#0d9d0d");
        const yellow = getVar("warning", "#d7a51d");
        const lightText = getVar("text-subtle", "#a0a0a0");

        term = new Terminal({
            fontFamily: '"SUSE Mono", monospace',
            fontSize: 14,
            cursorBlink: true,
            theme: {
                background: bg,
                foreground: fg,
                cursor: blue,
                selectionBackground: "rgba(41, 129, 229, 0.3)",
                black: getVar("surface-sunken", "#1d1d1d"),
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
                void copySelection(props.id);
                return false;
            }
            return true;
        });

        let disconnectData: (() => void) | null = null;
        // set while the session could not be opened: the next keypress
        // retries instead of typing into a shell that does not exist
        let failedId: string | null = null;
        term.onData((data) => {
            if (failedId !== null) {
                connect(failedId);
                return;
            }
            terminalApi.write(props.id, data);
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
            terminalApi.write(props.id, text);
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
                    if (props.id !== id) return;
                    failedId = id;
                    const reason = err instanceof Error ? err.message : String(err);
                    term?.write(
                        `\x1b[31mCould not open this terminal: ${reason}\x1b[0m\r\n` +
                            "Press any key to try again.\r\n",
                    );
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
            style={{
                width: "100%",
                height: "100%",
                flex: "1",
                background: getVarCss("surface-app"),
                color: getVarCss("text"),
                padding: getVarCss("uigap-half"),
                "box-sizing": "border-box",
                overflow: "hidden",
            }}
        />
    );
}

export default TerminalComponent;
