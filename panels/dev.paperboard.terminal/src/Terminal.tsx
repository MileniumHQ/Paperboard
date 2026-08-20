import { onMount, onCleanup } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getVar } from "paperui";
import { terminalApi, clipboardApi } from "paperapi";
import "@xterm/xterm/css/xterm.css";

export const activeTerminals = new Map<string, Terminal>();

export async function copySelection(id: string) {
    const term = activeTerminals.get(id);
    const selection = term?.getSelection() || window.getSelection()?.toString();
    if (selection) {
        try {
            await clipboardApi.writeText(selection);
        } catch {
            await navigator.clipboard?.writeText?.(selection);
        }
    }
}

export async function pasteClipboard(id: string) {
    try {
        let text = "";
        try {
            text = await clipboardApi.readText();
        } catch {
            text = (await navigator.clipboard?.readText?.()) || "";
        }
        if (text) {
            terminalApi.write(id, text);
        }
    } catch (err) {
        console.error("[Terminal] Paste failed:", err);
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
        document.fonts?.ready?.then(() => {
            safeFit();
        }).catch(() => {});

        const bg = getVar("--paper-background-backest", "#0d0e12");
        const fg = getVar("--paper-main-text", "#ffffff");
        const blue = getVar("--paper-front-blue", "#2981e5");
        const red = getVar("--paper-front-red", "#e73648");
        const green = getVar("--paper-front-green", "#0d9d0d");
        const yellow = getVar("--paper-front-yellow", "#d7a51d");
        const lightText = getVar("--paper-light-text", "#a0a0a0");

        term = new Terminal({
            fontFamily: '"SUSE Mono", monospace',
            fontSize: 14,
            cursorBlink: true,
            theme: {
                background: bg,
                foreground: fg,
                cursor: blue,
                selectionBackground: "rgba(41, 129, 229, 0.3)",
                black: getVar("--paper-background-back", "#1d1d1d"),
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

        terminalApi.onData(props.id, (data) => {
            term?.write(data);
        });

        term.onData((data) => {
            terminalApi.write(props.id, data);
        });

        terminalApi.create(props.id, {
            cols: term.cols,
            rows: term.rows,
        });

        const safeFit = () => {
            if (
                fitAddon &&
                containerRef &&
                containerRef.clientWidth > 50 &&
                containerRef.clientHeight > 50
            ) {
                try {
                    fitAddon.fit();
                    if (term) {
                        terminalApi.resize(props.id, term.cols, term.rows);
                    }
                } catch (e) {}
            }
        };

        requestAnimationFrame(() => {
            safeFit();
        });
        setTimeout(safeFit, 100);

        resizeObserver = new ResizeObserver(() => {
            safeFit();
        });
        resizeObserver.observe(containerRef);

        onCleanup(() => {
            if (resizeObserver) resizeObserver.disconnect();
            activeTerminals.delete(props.id);
            terminalApi.destroy(props.id);
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
                background: "var(--paper-background-backest)",
                color: "var(--paper-main-text)",
                padding: "var(--paper-uigap-half)",
                "box-sizing": "border-box",
                overflow: "hidden",
            }}
        />
    );
}

export default TerminalComponent;
