import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import { PaperButton, PaperInput, PaperSelector, PaperSelectorItem, PaperWizard, PaperWizardStep, useWizard } from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import { createFace, type FaceController } from "../face/controller";
import { createSpeaker, type Speaker } from "./speech";
import { CLAUDE_MODELS, harnessDescription, harnessName } from "../lib/brains";
import AgentLogo from "../../legacy/src/components/AgentLogo";
import { Budget, DEFAULT_BUDGET, SetupProgress } from "../computer/Computer";
import { LIMITS, type ComputerBudget, type Harness, type HarnessInfo } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./Onboarding.module.css";

// The first meeting: name, brain, and (if the user wants it now) the agent's
// computer. The speech is scripted; everything else is the service's: which
// harnesses are installed, saving the settings, and the computer's setup.

const NAMES = ["Pip", "Juniper", "Biscuit", "Nova", "Pebble", "Moss", "Echo", "Clover", "Ziggy", "Wren", "Tofu", "Atlas", "Maple", "Orbit", "Fern", "Scout"];

const DEFAULT_MODEL = "default";

const STEP = { name: 0, brain: 1, model: 2, computer: 3, budget: 4, install: 5 } as const;


/**
 * onSaving: the settings are about to be saved, so this window keeps the
 * onboarding open to show the computer's setup; onDone: it's finished.
 */
export default function Onboarding(props: { agent: Agent; onSaving: () => void; onDone: () => void }) {
    return (
        <div class={styles.page}>
            <Flow {...props} />
        </div>
    );
}

function Flow(props: { agent: Agent; onSaving: () => void; onDone: () => void }) {
    const { agent } = props;
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);
    const speaker = createSpeaker(face);

    const [name, setName] = createSignal("");
    const [harness, setHarness] = createSignal<Harness>();
    const [model, setModel] = createSignal<string>();
    const [computer, setComputer] = createSignal<"setup" | "later">();
    const [budget, setBudget] = createSignal<ComputerBudget>(DEFAULT_BUDGET);
    const placeholder = NAMES[Math.floor(Math.random() * NAMES.length)]!;

    // saving belongs to the service: an error here is its answer, shown with a way to try again
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const save = async (): Promise<boolean> => {
        setSaving(true);
        setSaveError(null);
        props.onSaving();
        try {
            await agent.setup({ name: name().trim(), harness: harness()!, model: model() === DEFAULT_MODEL ? null : (model() ?? null) });
            if (computer() === "setup") await agent.installComputer(budget());
            return true;
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setSaving(false);
        }
    };

    const finishLabel = () => (computer() === "later" ? "Let's chat" : "Start chatting");

    return (
        <PaperWizard
            class={styles.wizard}
            showProgress={false}
            hideBack
            finishLabel={finishLabel()}
            nextLabel={undefined}
            onComplete={async () => {
                // "Not yet" finishes at the budget step: save, then chat.
                // Setting up finishes at the install step, already saved.
                if (computer() === "setup" || (await save())) props.onDone();
            }}
        >
            <Scenes
                agent={agent}
                face={face}
                speaker={speaker}
                name={name}
                setName={setName}
                placeholder={placeholder}
                harness={harness}
                setHarness={setHarness}
                model={model}
                setModel={setModel}
                computer={computer}
                setComputer={setComputer}
                budget={budget}
                setBudget={setBudget}
                save={save}
                saving={saving}
                saveError={saveError}
                onDone={props.onDone}
            />
        </PaperWizard>
    );
}

type Getter<T> = () => T;
type Setter<T> = (v: T) => void;

function Scenes(props: {
    agent: Agent;
    face: FaceController;
    speaker: Speaker;
    name: Getter<string>;
    setName: Setter<string>;
    placeholder: string;
    harness: Getter<Harness | undefined>;
    setHarness: Setter<Harness>;
    model: Getter<string | undefined>;
    setModel: Setter<string>;
    computer: Getter<"setup" | "later" | undefined>;
    setComputer: Setter<"setup" | "later">;
    budget: Getter<ComputerBudget>;
    setBudget: Setter<ComputerBudget>;
    save: () => Promise<boolean>;
    saving: Getter<boolean>;
    saveError: Getter<string | null>;
    onDone: () => void;
}) {
    const wizard = useWizard()!;
    const { agent, face, speaker } = props;
    const name = () => props.name().trim();
    const machine = () => agent.state.computer;

    // what the scene shows besides the speech, once the speech is done
    const [revealed, setRevealed] = createSignal(false);
    const [speakerShown, setSpeakerShown] = createSignal(true);
    const [leaving, setLeaving] = createSignal(false);

    // which harnesses this computer has, as the service finds them
    const [harnesses, setHarnesses] = createSignal<HarnessInfo[] | null>(null);
    const [detectError, setDetectError] = createSignal<string | null>(null);
    const detect = async () => {
        setDetectError(null);
        try {
            setHarnesses(await agent.detect());
        } catch (e) {
            setDetectError(e instanceof Error ? e.message : String(e));
        }
    };
    void detect();
    const installed = () => (harnesses() ?? []).filter((h) => h.installed);

    // the Next button appears only when the scene is revealed and its answer is in
    const ready = () => {
        if (!revealed()) return false;
        switch (wizard.currentStep()) {
            case STEP.name:
                return name().length > 0;
            case STEP.brain:
                return Boolean(props.harness());
            case STEP.model:
                return Boolean(props.model());
            case STEP.computer:
                return Boolean(props.computer());
            case STEP.budget:
                return !props.saving();
            case STEP.install:
                return machine().phase === "ready";
            default:
                return true;
        }
    };
    createEffect(() => {
        wizard.setOptionsShown(ready());
        wizard.setCanProceed(ready());
    });

    const scenes: Record<number, () => Promise<boolean>> = {
        [STEP.name]: () =>
            speaker.say(["[happy]Hi there! I'm your personal agent. I don't have a name yet though, that's your call."]),
        [STEP.brain]: () =>
            speaker.say([
                `[satisfied][bounce]**${name()}** it is! [happy]I like that name.`,
                "[sad]I also don't have a brain yet. All this is prewritten. [happy]Fortunately, you can give me that too!\nI can think with an agent harness that's already installed on your computer.",
            ]),
        [STEP.model]: async () => {
            setSpeakerShown(false);
            speaker.clear();
            return true;
        },
        [STEP.computer]: async () => {
            speaker.clear();
            setSpeakerShown(true);
            face.look("home");
            face.express("strain");
            face.shake(true);
            const ok = await speaker.wait(1800);
            face.shake(false);
            if (!ok) return false;
            face.bounce();
            return speaker.say([
                "[satisfied]Great, I can think now!",
                "[happy]I can do so much more if I have my own computer. [surprised]Hear me out: what if we share this one!\nI can set up my own environment so I can't see or touch any of your stuff.",
            ]);
        },
        [STEP.budget]: () =>
            props.computer() === "later"
                ? speaker.say(["[sad]Aw. [pause 700][happy]Just kidding, I'm good. Alright, let's chat!"])
                : speaker.say([
                      "[wish]Awesome! [happy]I need a budget. What's the maximum amount of memory and storage you'd be okay with me using?",
                  ]),
        [STEP.install]: async () => {
            const ok = await speaker.say([
                "[happy]Sounds good. Now, I just need a moment to download and get everything set up. I'll be right with you!",
            ]);
            if (!ok) return false;
            if (!(await speaker.wait(900))) return false;
            setLeaving(true);
            if (!(await speaker.wait(700))) return false;
            setSpeakerShown(false);
            void props.save();
            return true;
        },
    };

    createEffect(
        on(wizard.currentStep, (step) => {
            setRevealed(false);
            void scenes[step]?.().then((finished) => finished && setRevealed(true));
        }),
    );

    // with nothing on screen but the agent, it sits in the middle of the page
    const alone = () =>
        !revealed() || (wizard.currentStep() === STEP.budget && props.computer() === "later" && !props.saveError());

    return (
        <div class={styles.flow}>
            <div class={styles.above} classList={{ [styles.centered!]: alone() }} />
            <Show when={speakerShown()}>
                <div class={styles.speaker} classList={{ [styles.leaving!]: leaving() }}>
                    <Face face={face} size={64} frame="face" />
                    <div
                        class={styles.bubble}
                        classList={{
                            [styles.hidden!]: !speaker.shown(),
                            // nothing said yet: fold the bubble away so the face stands alone
                            [styles.folded!]: !speaker.shown() && speaker.segments().length === 0,
                        }}
                        aria-live="polite"
                    >
                        <For each={speaker.segments()}>
                            {(seg) => (seg.br ? <br /> : seg.bold ? <strong>{seg.text}</strong> : <>{seg.text}</>)}
                        </For>
                    </div>
                </div>
            </Show>

            <PaperWizardStep class={styles.step} index={STEP.name} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <PaperInput
                        ref={(el) => queueMicrotask(() => el.focus())}
                        label="Name"
                        placeholder={props.placeholder}
                        value={props.name()}
                        onInput={(e) => props.setName(e.currentTarget.value)}
                        maxLength={LIMITS.name}
                    />
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.brain} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <Switch>
                        <Match when={detectError()}>
                            <p class={styles.error} role="alert">
                                Couldn't look for harnesses: {detectError()}
                            </p>
                            <PaperButton onClick={() => void detect()}>Look again</PaperButton>
                        </Match>
                        <Match when={harnesses() === null}>
                            <p class={styles.note}>Looking for harnesses…</p>
                        </Match>
                        <Match when={installed().length === 0}>
                            <p class={styles.note}>
                                I didn't find Codex or Claude Code on this computer. Install one and sign in to it, then look again.
                            </p>
                            <PaperButton onClick={() => void detect()}>Look again</PaperButton>
                        </Match>
                        <Match when={true}>
                            <PaperSelector name="harness" value={props.harness()} onValueChange={(v) => props.setHarness(v as Harness)}>
                                <For each={installed()}>
                                    {(h) => (
                                        <PaperSelectorItem
                                            value={h.id}
                                            icon={<AgentLogo agent={h.id} />}
                                            description={harnessDescription(h.id)}
                                        >
                                            {harnessName(h.id)}
                                        </PaperSelectorItem>
                                    )}
                                </For>
                            </PaperSelector>
                            <p class={styles.note}>You can change this later.</p>
                        </Match>
                    </Switch>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.model} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <h2 class={styles.title}>Choose a model</h2>
                    <PaperSelector name="model" value={props.model()} onValueChange={(v) => props.setModel(String(v))}>
                        <PaperSelectorItem value={DEFAULT_MODEL} icon="tune" description="Whatever it's set to use already.">
                            Use {harnessName(props.harness() ?? "")}'s default
                        </PaperSelectorItem>
                        <Show when={props.harness() === "claude-code"}>
                            <For each={CLAUDE_MODELS}>
                                {(m) => (
                                    <PaperSelectorItem value={m.id} icon={<AgentLogo agent="claude-code" />} description={m.description}>
                                        {m.name}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </Show>
                    </PaperSelector>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.computer} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <PaperSelector name="computer" value={props.computer()} onValueChange={(v) => props.setComputer(v as "setup" | "later")}>
                        <Show when={machine().phase !== "unsupported"}>
                            <PaperSelectorItem value="setup" icon="computer" description="This uses about 3.5 GB of storage and could take a while.">
                                Set up {name()}'s computer
                            </PaperSelectorItem>
                        </Show>
                        <PaperSelectorItem value="later" icon="schedule" description="You can set this up at any time later.">
                            Not yet
                        </PaperSelectorItem>
                    </PaperSelector>
                    <Show when={machine().phase === "unsupported"}>
                        <p class={styles.note}>This computer can't run mine yet: {machine().error}</p>
                    </Show>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.budget} canProceed={ready()}>
                <Show when={props.computer() === "setup"}>
                    <Reveal when={revealed()}>
                        <Budget name={name()} value={props.budget()} onChange={props.setBudget} />
                    </Reveal>
                </Show>
                <Show when={props.computer() === "later" && props.saveError()}>
                    <p class={styles.error} role="alert">
                        Couldn't save: {props.saveError()}
                    </p>
                </Show>
            </PaperWizardStep>

            <Show when={props.computer() === "setup"}>
                <PaperWizardStep class={styles.step} index={STEP.install} canProceed={ready()}>
                    <Show when={revealed()}>
                        <div class={styles.install}>
                            <h2 class={styles.title}>Setting up {name()}'s computer</h2>
                            <Switch>
                                <Match when={props.saveError()}>
                                    <p class={styles.error} role="alert">
                                        Couldn't get started: {props.saveError()}
                                    </p>
                                    <PaperButton disabled={props.saving()} onClick={() => void props.save()}>
                                        Try again
                                    </PaperButton>
                                </Match>
                                <Match when={true}>
                                    <SetupProgress computer={machine()} />
                                    <Show when={machine().phase === "failed" || machine().phase === "unsupported"}>
                                        <div class={styles.actions}>
                                            <Show when={machine().phase === "failed"}>
                                                <PaperButton disabled={props.saving()} onClick={() => void props.save()}>
                                                    Try again
                                                </PaperButton>
                                            </Show>
                                            <PaperButton variant="text" onClick={props.onDone}>
                                                Chat without it for now
                                            </PaperButton>
                                        </div>
                                    </Show>
                                </Match>
                            </Switch>
                        </div>
                    </Show>
                </PaperWizardStep>
            </Show>
            <div class={styles.below} />
        </div>
    );
}

function Reveal(props: { when: boolean; children: JSX.Element }) {
    return (
        <Show when={props.when}>
            <div class={styles.reveal}>{props.children}</div>
        </Show>
    );
}
