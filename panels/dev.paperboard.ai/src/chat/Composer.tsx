// The message box, after the legacy AI panel's composer: one rounded box with
// a growing text field and a row of quiet controls under it (the brain, the
// computer, more), with send or stop at the end. Messages sent while the
// agent works wait above the box, where they can be taken back or read now.

import { For, Show, createEffect, createSignal } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperIcon,
    PaperText,
    useContextMenuState,
} from "@mileniumhq/paperui";
import AgentLogo from "../../legacy/src/components/AgentLogo";
import { HARNESSES, LIMITS, type Harness } from "../contract";
import type { Agent } from "../lib/agent";
import type { Sheet } from "../Workspace";
import { brainLabel, harnessName } from "../lib/brains";
import styles from "./Composer.module.css";

const MAX_HEIGHT = "calc(var(--paper-uigap) * 12)";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Composer(props: { agent: Agent; onOpen: (sheet: Sheet) => void; onStartOver: () => void }) {
    const { agent } = props;
    const settings = () => agent.state.settings!;
    const name = () => settings().name;
    const busy = () => agent.state.chat.busy;
    const computer = () => agent.state.computer;

    const [draft, setDraft] = createSignal("");
    const [error, setError] = createSignal<string | null>(null);
    const [installed, setInstalled] = createSignal<Harness[] | null>(null);
    const brainMenu = useContextMenuState("above");
    const computerMenu = useContextMenuState("above");
    const moreMenu = useContextMenuState("above");
    let field!: HTMLTextAreaElement;
    let brainButton!: HTMLButtonElement;
    let computerButton!: HTMLButtonElement;
    let moreButton!: HTMLButtonElement;

    const attempt = async (fn: () => Promise<unknown>) => {
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(message(e));
            return false;
        }
    };

    const send = async () => {
        const text = draft().trim();
        if (!text) return;
        if (await attempt(() => agent.send(text))) setDraft("");
    };

    // grows with the text up to a bound; a sent message clears it from outside
    const resize = () => {
        field.style.height = "auto";
        field.style.height = `min(${field.scrollHeight}px, ${MAX_HEIGHT})`;
    };
    createEffect(() => {
        void draft();
        queueMicrotask(resize);
    });

    const openBrains = async () => {
        brainMenu.openAbove(brainButton);
        // which brains can be switched to is asked each time: one may have been installed since
        try {
            setInstalled((await agent.detect()).filter((h) => h.installed).map((h) => h.id));
        } catch (e) {
            setError(`Couldn't look for harnesses: ${message(e)}`);
        }
    };
    const switchBrain = (harness: Harness) => {
        brainMenu.close();
        if (harness === settings().harness) return;
        // a model belongs to its harness: the new brain starts on its own default
        void attempt(() => agent.setup({ ...settings(), harness, model: null }));
    };

    const computerLabel = () =>
        ({
            none: "No computer",
            unsupported: "No computer",
            installing: "Setting up",
            starting: "Starting",
            ready: computer().userControl ? "You're driving" : "Computer on",
            stopping: "Stopping",
            stopped: "Computer off",
            failed: "Computer stopped",
        })[computer().phase];

    return (
        <div class={styles.Composer}>
            <Show when={agent.state.chat.waiting.length > 0}>
                <section class={styles.waiting} aria-label="Waiting for the agent">
                    <div class={styles.waitingHead}>
                        <span>
                            {agent.state.chat.waiting.length === 1 ? "1 message waits" : `${agent.state.chat.waiting.length} messages wait`} for {name()}
                        </span>
                        <PaperButton size="tiny" variant="text" onClick={() => void attempt(agent.sendNow)} title={`Interrupt ${name()} so it reads these now`}>
                            <PaperIcon>bolt</PaperIcon> Send now
                        </PaperButton>
                    </div>
                    <For each={agent.state.chat.waiting}>
                        {(m) => (
                            <div class={styles.waitingItem}>
                                <span class={styles.waitingText}>{m.text}</span>
                                <PaperButton
                                    size="tiny"
                                    icon
                                    variant="text"
                                    aria-label="Take back"
                                    title="Take back"
                                    onClick={() => {
                                        // taken back into the box, so it can be edited and sent again
                                        void attempt(async () => {
                                            await agent.unqueue(m.id);
                                            if (!draft().trim()) setDraft(m.text);
                                        });
                                    }}
                                >
                                    undo
                                </PaperButton>
                            </div>
                        )}
                    </For>
                </section>
            </Show>

            <div class={styles.box}>
                <textarea
                    ref={field}
                    class={styles.field}
                    rows={1}
                    value={draft()}
                    maxLength={LIMITS.message}
                    placeholder={busy() ? `Add to what ${name()} is doing…` : `Message ${name()}`}
                    aria-label={`Message ${name()}`}
                    onInput={(e) => {
                        setDraft(e.currentTarget.value);
                        resize();
                    }}
                    onKeyDown={(e) => {
                        // Enter sends, Shift+Enter breaks the line
                        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                />

                <div class={styles.controls}>
                    <button
                        ref={brainButton}
                        type="button"
                        class={styles.brain}
                        aria-haspopup="menu"
                        aria-expanded={brainMenu.isOpen()}
                        aria-label={`Brain: ${brainLabel(settings())}`}
                        title={`${harnessName(settings().harness)}${settings().model ? `, ${settings().model}` : ""}`}
                        onClick={() => void openBrains()}
                    >
                        <span class={styles.logo}>
                            <AgentLogo agent={settings().harness} />
                        </span>
                        <span class={styles.brainName}>{brainLabel(settings())}</span>
                    </button>

                    <button
                        ref={computerButton}
                        type="button"
                        class={styles.picker}
                        classList={{ [styles.attention!]: computer().phase === "failed" || computer().userControl }}
                        aria-haspopup="menu"
                        aria-expanded={computerMenu.isOpen()}
                        aria-label={`Computer: ${computerLabel()}`}
                        onClick={() => computerMenu.openAbove(computerButton)}
                    >
                        <PaperIcon class={styles.pickerIcon}>computer</PaperIcon>
                        <span>{computerLabel()}</span>
                        <PaperIcon class={styles.pickerChevron}>expand_more</PaperIcon>
                    </button>

                    <span class={styles.spacer} />

                    <PaperButton
                        ref={moreButton}
                        icon
                        size="small"
                        variant="text"
                        class={styles.more}
                        aria-label="More"
                        title="More"
                        aria-haspopup="menu"
                        aria-expanded={moreMenu.isOpen()}
                        onClick={() => moreMenu.openAbove(moreButton, { align: "right" })}
                    >
                        more_horiz
                    </PaperButton>

                    <Show
                        when={busy() && !draft().trim()}
                        fallback={
                            <PaperEffect variant="primary" disabled={!draft().trim()}>
                                <PaperButton
                                    icon
                                    size="small"
                                    variant="primary"
                                    disabled={!draft().trim()}
                                    onClick={() => void send()}
                                    aria-label={busy() ? `Send when ${name()} is ready` : "Send"}
                                    title={busy() ? `Send when ${name()} is ready` : "Send"}
                                >
                                    arrow_upward
                                </PaperButton>
                            </PaperEffect>
                        }
                    >
                        <PaperEffect variant="danger">
                            <PaperButton icon size="small" variant="danger" onClick={() => void attempt(agent.stop)} aria-label={`Stop ${name()}`} title={`Stop ${name()}`}>
                                stop
                            </PaperButton>
                        </PaperEffect>
                    </Show>
                </div>

                <Show when={error()}>
                    <PaperText size={1} color="danger" role="alert">
                        {error()}
                    </PaperText>
                </Show>
            </div>

            <Show when={computer().userControl}>
                <PaperText size={1} color="text-muted" class={styles.reason}>
                    <PaperIcon zeroHeight>info</PaperIcon> You have {name()}'s computer. {name()} waits to use it until you hand it back.
                </PaperText>
            </Show>

            <PaperContextMenu open={brainMenu.isOpen()} target={brainMenu.target()} placement={brainMenu.placement()} onClose={brainMenu.close}>
                <For each={HARNESSES}>
                    {(h) => (
                        <PaperContextMenuItem
                            value={h}
                            icon={settings().harness === h ? "check" : undefined}
                            disabled={installed() !== null && !installed()!.includes(h)}
                            description={installed() !== null && !installed()!.includes(h) ? "Not installed" : undefined}
                            onClick={() => switchBrain(h)}
                        >
                            {harnessName(h)}
                        </PaperContextMenuItem>
                    )}
                </For>
                <PaperContextMenuItem
                    value="model"
                    icon="tune"
                    onClick={() => {
                        brainMenu.close();
                        props.onOpen("settings");
                    }}
                >
                    Model and name…
                </PaperContextMenuItem>
            </PaperContextMenu>

            <PaperContextMenu open={computerMenu.isOpen()} target={computerMenu.target()} placement={computerMenu.placement()} onClose={computerMenu.close}>
                <Show when={computer().phase === "ready"}>
                    <PaperContextMenuItem
                        value="windows"
                        icon="web_asset"
                        onClick={() => {
                            computerMenu.close();
                            props.onOpen("computer");
                        }}
                    >
                        Show its windows
                    </PaperContextMenuItem>
                    <PaperContextMenuItem
                        value="off"
                        icon="power_settings_new"
                        onClick={() => {
                            computerMenu.close();
                            void attempt(agent.stopComputer);
                        }}
                    >
                        Turn off
                    </PaperContextMenuItem>
                </Show>
                <Show when={computer().installed && (computer().phase === "stopped" || computer().phase === "failed")}>
                    <PaperContextMenuItem
                        value="on"
                        icon="power_settings_new"
                        onClick={() => {
                            computerMenu.close();
                            void attempt(agent.startComputer);
                        }}
                    >
                        Turn on
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem
                    value="settings"
                    icon="settings"
                    onClick={() => {
                        computerMenu.close();
                        props.onOpen("settings");
                    }}
                >
                    Computer settings…
                </PaperContextMenuItem>
            </PaperContextMenu>

            <PaperContextMenu open={moreMenu.isOpen()} target={moreMenu.target()} placement={moreMenu.placement()} onClose={moreMenu.close}>
                <PaperContextMenuItem
                    value="computer"
                    icon="computer"
                    onClick={() => {
                        moreMenu.close();
                        props.onOpen("computer");
                    }}
                >
                    Computer
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="memories"
                    icon="neurology"
                    onClick={() => {
                        moreMenu.close();
                        props.onOpen("memories");
                    }}
                >
                    Memories
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="settings"
                    icon="settings"
                    onClick={() => {
                        moreMenu.close();
                        props.onOpen("settings");
                    }}
                >
                    Settings
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="start-over"
                    icon="delete_sweep"
                    onClick={() => {
                        moreMenu.close();
                        props.onStartOver();
                    }}
                >
                    Start over…
                </PaperContextMenuItem>
            </PaperContextMenu>
        </div>
    );
}
