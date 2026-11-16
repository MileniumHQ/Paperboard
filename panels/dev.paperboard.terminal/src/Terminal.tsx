import { onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { copyText, createLatest, pasteText, type ActionFailure } from "@mileniumhq/paperui";
import { terminalApi, errorMessage } from "@mileniumhq/paperapi";
import { terminal } from "./client";
import { terminalKeyAction, type TerminalKeyAction } from "./keys";
import { keyBytes, withModifiers, type Modifiers, type NamedKey } from "./lib/softKeys";
import { joinScrollback } from "./lib/scrollback";
import { linkOpens, outputText, pasteRunsAtOnce, promptTarget, type ScreenLine } from "./lib/screen";
import { onThemeChange, screenColors, token } from "./lib/theme";
import { writeRefusal, writeTerminal } from "./lib/terminalWrite";
import styles from "./Terminal.module.css";
import "@xterm/xterm/css/xterm.css";

/** what the panel can do with one session's screen */
export interface TerminalHandle {
    term: Terminal;
    focus(): void;
    /** pastes as typed, asking first when the paste would run at once */
    paste(text: string): Promise<void>;
    /** sends a key the phone's keyboard doesn't have, as the program running now reads it */
    sendKey(key: NamedKey): void;
    /** types text as the keyboard would, so a latched Ctrl or Alt applies to it */
    type(text: string): void;
    /** the last finished command's output; null before one has finished */
    lastOutput(): string | null;
    /** scrolls to the shell's previous or next prompt; false when there is none */
    jumpToPrompt(direction: -1 | 1): boolean;
    /** highlights matches and moves to the next or previous; false when nothing matches */
    find(query: string, direction: -1 | 1): boolean;
    clearFind(): void;
}

export const activeTerminals = new Map<string, TerminalHandle>();

// the command line an OSC 133 C mark carries (cmdline_url=, percent-encoded); "" when it carries none
function commandLine(params: string[]): string {
    const encoded = params.find((p) => p.startsWith("cmdline_url="))?.slice("cmdline_url=".length);
    if (!encoded) return "";
    try {
        return decodeURIComponent(encoded).trim();
    } catch (err) {
        // a line that isn't valid percent-encoding is one the shell didn't say: the tab goes by its program
        console.debug("[terminal] a running command's line wasn't valid percent-encoding:", err);
        return "";
    }
}

export async function copySelection(id: string) {
    const term = activeTerminals.get(id)?.term;
    const selection = term?.getSelection() || window.getSelection()?.toString() || "";
    if (!selection) throw new Error("Nothing is selected. Select text on the screen, then copy.");
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
    onFailure: (failure: ActionFailure) => void;
    /** the screen took the keyboard */
    onFocus?: () => void;
    /** Ctrl and Alt latched by the key row, applied to the next key typed */
    modifiers?: () => Modifiers;
    /** the next key used up the latched modifiers */
    onModifiersUsed?: () => void;
    /** the shell printed while this screen was hidden */
    onActivity?: () => void;
    /** the shell rang the bell */
    onBell?: () => void;
    /**
     * The command the shell marked as running now, as typed ("" when it
     * didn't say the line), or null once it is back at its prompt. A shell
     * that marks nothing never says.
     */
    onRunning?: (command: string | null) => void;
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
        const colors = screenColors();

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
            theme: colors.theme,
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
        // the command it marked as started and not yet ended
        let running: string | null = null;
        term.parser.registerOscHandler(133, (data) => {
            const [kind, ...params] = data.split(";");
            if (kind === "A") atPrompt = true;
            else if (kind === "C") atPrompt = false;
            // a second mark of the same command (fish marks its own) keeps the line the other said
            if (kind === "C") running = commandLine(params) || running || "";
            else if (kind === "A" || kind === "D") running = null;
            if (kind === "A" || kind === "C" || kind === "D") props.onRunning?.(running);
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
        // the history written back after a reload holds bells that rang long ago: only a bell rung now is news
        let replaying = false;
        term.onBell(() => {
            if (!replaying) props.onBell?.();
        });

        let searchDecorations = colors.search;
        // the app's theme switched: the screen takes the new colors, and so do the matches it highlights
        const offTheme = onThemeChange(() => {
            const next = screenColors();
            term.options.theme = next.theme;
            searchDecorations = next.search;
        });

        // the pty follows the screen: a resize the daemon refused is said
        // once, and sent again on the next fit. Until the session is open its
        // size goes with the open, so a resize never races the shell starting
        let opened = false;
        let sentCols = 0;
        let sentRows = 0;
        let refused = "";
        const fit = () => {
            // a hidden tab has no size to fit to; it fits when it is shown
            if (containerRef.clientWidth === 0 || containerRef.clientHeight === 0) return;
            fitAddon.fit();
            if (!opened) return;
            const { cols, rows } = term;
            if (cols === sentCols && rows === sentRows) return;
            terminalApi
                .resize(props.id, cols, rows)
                .then(() => {
                    sentCols = cols;
                    sentRows = rows;
                    refused = "";
                })
                .catch((err) => {
                    if (refused === `${cols}x${rows}`) return;
                    refused = `${cols}x${rows}`;
                    props.onFailure({ title: "Screen size not sent", message: `The shell didn't take this screen's size, so long lines may wrap wrong: ${errorMessage(err)}` });
                });
        };
        // fit before attach so the pty starts at its real size
        fit();
        // The code font loads when something first draws with it, so the cells were measured with the fallback
        // until then: measure again once it is in, and fit to the true cell size.
        const codeFont = `${term.options.fontSize}px ${term.options.fontFamily}`;
        if (!document.fonts.check(codeFont)) {
            document.fonts.load(codeFont).then(
                () => {
                    // xterm measures a cell when its font option changes, so the option is set again
                    const family = term.options.fontFamily;
                    term.options.fontFamily = "monospace";
                    term.options.fontFamily = family;
                    fit();
                },
                (err) => props.onFailure({ title: "Font not loaded", message: errorMessage(err) }),
            );
        }
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
        const attempt = createLatest();
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
            const current = attempt();
            stopped = false;
            opened = false;
            disconnect?.();
            term.reset();
            replaying = false;
            prompts = [];
            commands = [];
            running = null;
            props.onRunning?.(null);
            // output that arrives while the scrollback is on its way waits
            // here, then joins it without repeating what the scrollback holds
            let pending: string[] | null = [];
            const offData = terminalApi.onData(id, (data) => {
                if (pending) pending.push(data);
                else term.write(data);
                if (hidden()) props.onActivity?.();
            });
            const offExit = terminalApi.onExit(id, (code) => {
                // nothing runs in a shell that is gone
                running = null;
                props.onRunning?.(null);
                stop(`This shell exited${code ? ` with code ${code}` : ""}.`, "Press any key to start a new one.");
            });
            disconnect = () => {
                offData();
                offExit();
            };
            const { cols, rows } = term;
            terminal.calls
                .openTab({ id, cols, rows })
                .then((scrollback) => {
                    if (!current()) return;
                    opened = true;
                    sentCols = cols;
                    sentRows = rows;
                    // the screen may have changed size while it opened
                    fit();
                    replaying = true;
                    term.write(joinScrollback(scrollback, pending!), () => (replaying = false));
                    pending = null;
                })
                .catch((err) => {
                    if (!current()) return;
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
        term.onData((data) => {
            const typed = withModifiers(data, props.modifiers?.() ?? { ctrl: false, alt: false });
            if (typed.consumed) props.onModifiersUsed?.();
            send(typed.data);
        });

        const handle: TerminalHandle = {
            term,
            focus: () => term.focus(),
            sendKey: (key) => {
                const mods = props.modifiers?.() ?? { ctrl: false, alt: false };
                // user input, so it reaches the shell the way a typed key does
                term.input(keyBytes(key, term.modes.applicationCursorKeysMode, mods), true);
                props.onModifiersUsed?.();
            },
            type: (text) => term.input(text, true),
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
            offTheme();
            disconnect?.();
            activeTerminals.delete(props.id);
            // Sessions are service-owned and survive UI reloads; only the
            // local renderer is disposed here.
            term.dispose();
        });
    });

    // xterm measures its parent to fit, so the padding sits outside it. A tap
    // anywhere on the screen, padding included, takes the keyboard; the
    // click is the gesture a phone allows to raise its on-screen keyboard
    // (a scroll or a long press never becomes a click).
    return (
        <div
            class={styles.screen}
            onClick={() => activeTerminals.get(props.id)?.focus()}
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
