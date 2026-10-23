import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import {
    PaperButton,
    PaperInput,
    PaperSelector,
    PaperSelectorItem,
    PaperWizard,
    PaperWizardStep,
    useWizard,
} from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import { skinFor } from "../face/skins";
import { createFace, type FaceController } from "../face/controller";
import { createSpeaker, type Speaker } from "./speech";
import { scriptFor } from "./script";
import { SEARCH_MODELS_FROM, createModels, harnessDescription, harnessName, loadedModels } from "../lib/brains";
import BrainLogo from "../lib/BrainLogo";
import { SetupProgress } from "../computer/Computer";
import { LIMITS, characterOf, type Harness, type HarnessInfo } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./Onboarding.module.css";

// The first meeting: name, brain, and (if the user wants it now) the agent's
// computer. The speech is scripted; everything else is the service's: which
// harnesses are installed, saving the settings, and the computer's setup.

const NAMES = ["Pip", "Juniper", "Biscuit", "Nova", "Pebble", "Moss", "Echo", "Clover", "Ziggy", "Wren", "Tofu", "Atlas", "Maple", "Orbit", "Fern", "Scout"];

const DEFAULT_MODEL = "default";

// the last step is the answer to the computer: setting it up, or not yet
const STEP = { name: 0, brain: 1, model: 2, computer: 3, last: 4 } as const;


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
            if (computer() === "setup") await agent.installComputer();
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
                // "Not yet" finishes here: save, then chat. Setting up finishes already saved.
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
    setModel: Setter<string | undefined>;
    computer: Getter<"setup" | "later" | undefined>;
    setComputer: Setter<"setup" | "later">;
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

    // the chosen brain's own models; a model belongs to its harness, so another brain is chosen afresh
    const models = createModels(agent, props.harness);
    createEffect(
        on(
            props.harness,
            () => {
                props.setModel(undefined);
                setSearch("");
            },
            { defer: true },
        ),
    );
    // a long list (OpenCode's) gets a search field: every word typed is somewhere in the name, the provider or the id
    const [search, setSearch] = createSignal("");
    const found = () => {
        const words = search().toLowerCase().split(/\s+/).filter(Boolean);
        const all = loadedModels(models) ?? [];
        return all.filter((m) => {
            const text = `${m.name} ${m.description ?? ""} ${m.id}`.toLowerCase();
            return words.every((w) => text.includes(w));
        });
    };

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
            case STEP.last:
                return props.computer() === "later" ? !props.saving() : machine().phase === "ready";
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
        [STEP.brain]: () => speaker.say(scriptFor(name()).named(name())),
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
            return speaker.say(scriptFor(name()).computer);
        },
        [STEP.last]: async () => {
            if (props.computer() === "later") return speaker.say(scriptFor(name()).later);
            const ok = await speaker.say(scriptFor(name()).install);
            if (!ok) return false;
            if (!(await speaker.wait(900))) return false;
            setLeaving(true);
            if (!(await speaker.wait(700))) return false;
            setSpeakerShown(false);
            void props.save();
            return true;
        },
    };

    // a name that brings a character is recognized as it's typed: the face lights up in its new look (and settles back if it's typed away)
    createEffect(
        on(
            () => characterOf(name()),
            (character) => {
                if (wizard.currentStep() !== STEP.name || speaker.speaking()) return;
                face.express(character ? "wish" : "happy");
                if (character) face.bounce();
            },
            { defer: true },
        ),
    );

    createEffect(
        on(wizard.currentStep, (step) => {
            setRevealed(false);
            void scenes[step]?.().then((finished) => finished && setRevealed(true));
        }),
    );

    // with nothing on screen but the agent, it sits in the middle of the page
    const alone = () =>
        !revealed() || (wizard.currentStep() === STEP.last && props.computer() === "later" && !props.saveError());

    return (
        <div class={styles.flow}>
            <div class={styles.above} classList={{ [styles.centered!]: alone() }} />
            <Show when={speakerShown()}>
                <div class={styles.speaker} classList={{ [styles.leaving!]: leaving() }}>
                    <span class={styles.faceChip}>
                        <Face face={face} size={64} frame="sphere" skin={skinFor(name())} />
                    </span>
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
                                I didn't find Codex, Claude or OpenCode on this computer. Install one and sign in to it, then look again.
                            </p>
                            <PaperButton onClick={() => void detect()}>Look again</PaperButton>
                        </Match>
                        <Match when={true}>
                            <PaperSelector name="harness" value={props.harness()} onValueChange={(v) => props.setHarness(v as Harness)}>
                                <For each={installed()}>
                                    {(h) => (
                                        <PaperSelectorItem
                                            value={h.id}
                                            icon={<BrainLogo harness={h.id} />}
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
                    <Show when={(loadedModels(models)?.length ?? 0) >= SEARCH_MODELS_FROM}>
                        <PaperInput label="Search" icon="search" fullWidth placeholder="Search models" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
                    </Show>
                    <PaperSelector name="model" value={props.model()} onValueChange={(v) => props.setModel(String(v))}>
                        <PaperSelectorItem value={DEFAULT_MODEL} icon="tune" description="Whatever it's set to use already.">
                            Use {harnessName(props.harness() ?? "")}'s default
                        </PaperSelectorItem>
                        <For each={found()}>
                            {(m) => (
                                <PaperSelectorItem value={m.id} icon={<BrainLogo harness={props.harness()!} />} description={m.description ?? undefined}>
                                    {m.name}
                                </PaperSelectorItem>
                            )}
                        </For>
                    </PaperSelector>
                    <Show when={models.error}>
                        <p class={styles.note}>{models.error instanceof Error ? models.error.message : String(models.error)} You can pick one later in settings.</p>
                    </Show>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.computer} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <PaperSelector name="computer" value={props.computer()} onValueChange={(v) => props.setComputer(v as "setup" | "later")}>
                        <Show when={machine().phase !== "unsupported"}>
                            <PaperSelectorItem value="setup" icon="computer" description="A web browser of its own, about 400 MB of storage.">
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

            {/* always there, so the computer's step is never taken for the last one before it's answered */}
            <PaperWizardStep class={styles.step} index={STEP.last} canProceed={ready()}>
                <Show when={props.computer() === "later" && props.saveError()}>
                    <p class={styles.error} role="alert">
                        Couldn't save: {props.saveError()}
                    </p>
                </Show>
                <Show when={props.computer() === "setup"}>
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
                </Show>
            </PaperWizardStep>
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
