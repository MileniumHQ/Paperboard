import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { copyText, getVar, pasteText } from "@mileniumhq/paperui";
import { terminalApi, actions as actionsApi } from "@mileniumhq/paperapi";
import { terminalKeyAction, type TerminalKeyAction } from "./keys";
import { errorMessage, type Outcome } from "./lib/failure";
import { joinScrollback } from "./lib/scrollback";
import { linkOpens, outputText, pasteRunsAtOnce, promptTarget, type ScreenLine } from "./lib/screen";
import { writeRefusal, writeTerminal } from "./lib/terminalWrite";
import styles from "./Terminal.module.css";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

/** what the panel can do with one session's screen */
export interface TerminalHandle {
    term: Terminal;
    focus(): void;
    /** pastes as typed, asking first when the paste would run at once */
    paste(text: string): Promise<void>;
    /** the last finished command's output; null before one has finished */
    lastOutput(): string | null;
    /** scrolls to the shell's previous or next prompt; false when there is none */
    jumpToPrompt(direction: -1 | 1): boolean;
    /** highlights matches and moves to the next or previous; false when nothing matches */
    find(query: string, direction: -1 | 1): boolean;
    clearFind(): void;
}

export const activeTerminals = new Map<string, TerminalHandle>();

// xterm paints a canvas, so it needs the theme's resolved values; a token
// that isn't defined is a broken stylesheet, not a reason to guess a color
function token(name: string): string {
    const value = getVar(name);
    if (!value) throw new Error(`PaperUI token --paper-${name} is not defined`);
    return value;
}

export async function copySelection(id: string) {
    const term = activeTerminals.get(id)?.term;
    const selection = term?.getSelection() || window.getSelection()?.toString() || "";
    if (!selection) return;
    // copyText owns the async-clipboard-plus-fallback path, same as PaperCopyButton
    if (!(await copyText(selection))) throw new Error("The clipboard refused the selection.");
}

export async function pasteClipboard(id: string) {
    const handle = activeTerminals.get(id);
    // readText is denied unless the panel frame holds clipboard focus; the
    // context-menu click can leave focus on the menu, so focus the terminal
    // (and its helper textarea) before reading
    handle?.focus();
    const text = await pasteText();
    // null is unavailable, "" is an empty clipboard: neither writes to the shell
    if (text === null) throw new Error("The clipboard couldn't be read here. Paste with the keyboard instead.");
    if (!text) return;
    if (!handle) throw new Error("This terminal isn't open.");
    await handle.paste(text);
}

export interface TerminalComponentProps {
    id: string;
    onContextMenu?: (e: MouseEvent | PointerEvent) => void;
    /** a copy, paste or link that failed, said where the panel can show it */
    onFailure: (failure: Outcome) => void;
    /** the screen took the keyboard */
    onFocus?: () => void;
    /** the shell printed while this screen was hidden */
    onActivity?: () => void;
    /** the shell rang the bell */
    onBell?: () => void;
    /** a shortcut for the panel (find) */
    onKeyAction?: (action: Exclude<TerminalKeyAction, null | "copy">) => void;
    /** this screen has the keyboard in its window: a paste from outside the screen lands here */
    focused: boolean;
    /** asks whether a paste that would run at once should go; resolves true to paste */
    confirmPaste: (text: string) => Promise<boolean>;
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

        const openLink = (uri: string) => {
            if (!linkOpens(uri)) {
                props.onFailure({ title: "Link not opened", message: `${uri} isn't a web address. Links open when they start with https://, or http:// on this computer.` });
                return;
            }
            window.open(uri, "_blank", "noopener,noreferrer");
        };

        const term = new Terminal({
            fontFamily: token("font-family-code"),
            fontSize: Number.parseFloat(token("text-size-2")),
            cursorBlink: true,
            allowProposedApi: true,
            // links a program prints as links (OSC 8), such as ls --hyperlink
            linkHandler: { activate: (_event, uri) => openLink(uri) },
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
        const search = new SearchAddon();
        term.loadAddon(search);
        // addresses printed as text
        term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
        term.open(containerRef);

        // The shell's marks (see the daemon's shell integration): where each
        // prompt starts, and where each command's output starts and ends. A
        // mark can come twice (fish marks its own prompts too); the second
        // changes nothing.
        let prompts: IMarker[] = [];
        let commands: { start: IMarker; end?: IMarker }[] = [];
        const live = (marker: IMarker) => !marker.isDisposed && marker.line >= 0;
        // the shell marked a prompt and hasn't started a command since
        let atPrompt = false;
        term.parser.registerOscHandler(133, (data) => {
            const kind = data.split(";", 1)[0];
            if (kind === "A") atPrompt = true;
            else if (kind === "C") atPrompt = false;
            if (kind === "A") {
                prompts = prompts.filter(live);
                const marker = term.registerMarker(0);
                if (marker && prompts.some((p) => p.line === marker.line)) marker.dispose();
                else if (marker) prompts.push(marker);
            } else if (kind === "C") {
                commands = commands.filter((c) => live(c.start));
                const open = commands.at(-1);
                if (open && !open.end) return true;
                const marker = term.registerMarker(0);
                if (marker) commands.push({ start: marker });
            } else if (kind === "D") {
                const open = commands.at(-1);
                if (open && !open.end) open.end = term.registerMarker(0);
            }
            return true;
        });
        term.onBell(() => props.onBell?.());

        const searchDecorations = {
            matchBackground: token("selection"),
            matchOverviewRuler: blue,
            activeMatchBackground: yellow,
            activeMatchColorOverviewRuler: yellow,
        };

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
            const action = terminalKeyAction(arg);
            if (!action) return true;
            if (action === "copy") {
                copySelection(props.id).catch((err) =>
                    props.onFailure({ title: "Nothing copied", message: errorMessage(err) }),
                );
            } else if (action === "previous-prompt" || action === "next-prompt") {
                handle.jumpToPrompt(action === "previous-prompt" ? -1 : 1);
            } else {
                props.onKeyAction?.(action);
            }
            arg.preventDefault();
            return false;
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
        const hidden = () => containerRef.getClientRects().length === 0;
        const connect = () => {
            const id = props.id;
            const current = ++attempt;
            stopped = false;
            disconnect?.();
            term.reset();
            prompts = [];
            commands = [];
            // output that arrives while the scrollback is on its way waits
            // here, then joins it without repeating what the scrollback holds
            let pending: string[] | null = [];
            const offData = terminalApi.onData(id, (data) => {
                if (pending) pending.push(data);
                else term.write(data);
                if (hidden()) props.onActivity?.();
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
            // an oversized paste is refused whole, and the session is fine
            const refusal = writeRefusal(data);
            if (refusal) {
                props.onFailure({ title: "Nothing pasted", message: refusal });
                return;
            }
            writeTerminal(props.id, data).catch((err) => {
                console.error("[terminal] write failed:", err);
                stop(`Lost this terminal: ${errorMessage(err)}`, "Press any key to try again.");
            });
        };
        term.onData(send);

        const handle: TerminalHandle = {
            term,
            focus: () => term.focus(),
            paste: async (text) => {
                if (pasteRunsAtOnce(text, { atPrompt, bracketedPaste: term.modes.bracketedPasteMode }) && !(await props.confirmPaste(text))) return;
                // as the keyboard pastes: bracketed when the shell asked for it
                term.paste(text);
                term.focus();
            },
            lastOutput: () => {
                const done = [...commands].reverse().find((c) => c.end && live(c.start) && live(c.end));
                if (!done) return null;
                const buffer = term.buffer.active;
                const lines: ScreenLine[] = [];
                for (let y = done.start.line; y < done.end!.line; y++) {
                    const line = buffer.getLine(y);
                    if (line) lines.push({ text: line.translateToString(true), wrapped: line.isWrapped });
                }
                return outputText(lines);
            },
            jumpToPrompt: (direction) => {
                const line = promptTarget(prompts.filter(live).map((p) => p.line), term.buffer.active.viewportY, direction);
                if (line === null) {
                    if (direction > 0) term.scrollToBottom();
                    return false;
                }
                term.scrollToLine(line);
                return true;
            },
            find: (query, direction) =>
                direction > 0
                    ? search.findNext(query, { decorations: searchDecorations })
                    : search.findPrevious(query, { decorations: searchDecorations }),
            clearFind: () => {
                search.clearDecorations();
                term.clearSelection();
            },
        };
        activeTerminals.set(props.id, handle);

        // A paste that would run commands as it lands is asked about first.
        // Taken before xterm's own listener (on its textarea, inside this
        // element) can see it.
        const onPasteHere = (ev: ClipboardEvent) => {
            const text = ev.clipboardData?.getData("text/plain");
            if (!text || !pasteRunsAtOnce(text, { atPrompt, bracketedPaste: term.modes.bracketedPasteMode })) return;
            ev.preventDefault();
            ev.stopPropagation();
            handle.paste(text).catch((err) => props.onFailure({ title: "Nothing pasted", message: errorMessage(err) }));
        };
        containerRef.addEventListener("paste", onPasteHere, true);

        // A native paste with focus outside xterm (for example the context
        // menu item) never reaches xterm's own paste listener. Route it here,
        // but let xterm own pastes inside its element so nothing is written
        // twice.
        const onPaste = (ev: ClipboardEvent) => {
            // every tab stays mounted; only the focused screen may answer a
            // paste delivered outside xterm, or another one would also write
            if (hidden() || !props.focused) return;
            if (containerRef.contains(ev.target as Node | null)) return;
            const text = ev.clipboardData?.getData("text/plain");
            if (!text) return;
            ev.preventDefault();
            handle.paste(text).catch((err) => props.onFailure({ title: "Nothing pasted", message: errorMessage(err) }));
        };
        document.addEventListener("paste", onPaste);

        const onFocusIn = () => props.onFocus?.();
        containerRef.addEventListener("focusin", onFocusIn);

        createEffect(on(() => props.id, connect));

        onCleanup(() => {
            document.removeEventListener("paste", onPaste);
            containerRef.removeEventListener("paste", onPasteHere, true);
            containerRef.removeEventListener("focusin", onFocusIn);
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
                props.onFocus?.();
                props.onContextMenu?.(e);
            }}
        >
            <div ref={containerRef} class={styles.fit} />
        </div>
    );
}

export default TerminalComponent;
