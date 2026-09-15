import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getVar, getVarCss } from "@paperboard-dev/paperui";
import { terminalApi, actions as actionsApi } from "@paperboard-dev/paperapi";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export const activeTerminals = new Map<string, Terminal>();

export async function copySelection(id: string) {
    const term = activeTerminals.get(id);
    const selection = term?.getSelection() || window.getSelection()?.toString();
    if (selection) {
        try {
            await navigator.clipboard.writeText(selection);
        } catch (err) {
            // a denied clipboard must not become an unhandled rejection
            console.error(`[Terminal] copy failed for ${id}:`, err);
        }
    }
}

export async function pasteClipboard(id: string) {
    try {
        const text = await navigator.clipboard.readText();
        if (text) terminalApi.write(id, text);
    } catch (err) {
        // a denied clipboard must not become an unhandled rejection
        console.error(`[Terminal] paste failed for ${id}:`, err);
    }
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
            lastCols = term.cols;
            lastRows = term.rows;
            terminalApi.resize(props.id, term.cols, term.rows);
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
            if (arg.ctrlKey && arg.shiftKey && arg.type === "keydown") {
                if (arg.code === "KeyC") {
                    copySelection(props.id);
                    return false;
                }
                if (arg.code === "KeyV") {
                    pasteClipboard(props.id);
                    return false;
                }
            }
            return true;
        });

        let disconnectData: (() => void) | null = null;
        term.onData((data) => terminalApi.write(props.id, data));
        const connect = (id: string) => {
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
                    // open-tab failed (no such tab yet) — creating fresh is
                    // the recovery, logged so a real outage stays visible
                    console.debug("[terminal] open-tab failed, creating fresh session:", String(err));
                    terminalApi.create(id, {
                        cols: term?.cols,
                        rows: term?.rows,
                    });
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
