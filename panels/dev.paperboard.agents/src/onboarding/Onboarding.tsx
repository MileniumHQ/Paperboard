import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperLoader,
    PaperQuote,
    PaperSectionHeader,
    PaperSelector,
    PaperSelectorItem,
    PaperWizard,
    PaperText,
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
import { HARNESSES, LIMITS, characterOf, type Harness } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";
import { BrainButtons, BrainStatus, brainLine, createBrainActions } from "../settings/Brain";
import Providers from "../settings/Providers";
import { glideWhenRecentered } from "./glide";
import styles from "./Onboarding.module.css";

// The first meeting: name, brain, and (if the user wants it now) the agent's
// computer. The speech is scripted; everything else is the service's: the
// brain's install and sign-in, saving the settings, and the computer's setup.
// Choosing a brain and pressing Next is all it takes: the next step installs
// it and opens its sign-in.

const NAMES = ["Pip", "Juniper", "Biscuit", "Nova", "Pebble", "Moss", "Echo", "Clover", "Ziggy", "Wren", "Tofu", "Atlas", "Maple", "Orbit", "Fern", "Scout"];

const DEFAULT_MODEL = "default";

// the last step is the answer to the computer: setting it up, or not yet
const STEP = { name: 0, brain: 1, signIn: 2, model: 3, computer: 4, last: 5 } as const;


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
            await agent.setup({ name: name().trim(), harness: harness()!, model: model() === DEFAULT_MODEL ? null : (model() ?? null), compaction: "summarize" });
            if (computer() === "setup") await agent.installComputer();
            return true;
        } catch (e) {
            setSaveError(errorText(e));
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

    // the chosen brain is installed and signed in by the next step; its models can be listed once it is
    const actions = createBrainActions(agent);
    const [providers, setProviders] = createSignal(false);
    const brain = () => (props.harness() ? agent.state.brains[props.harness()!] : undefined);
    const brainReady = () => brain()?.phase === "ready";
    // each brain is installed and signed in once per visit to the step; stopping a sign-in doesn't start another by itself
    const started = new Set<string>();
    createEffect(() => {
        const h = props.harness();
        const b = brain();
        if (!h || !b || wizard.currentStep() !== STEP.signIn) return;
        if (b.phase === "none" && !started.has(`install:${h}`)) {
            started.add(`install:${h}`);
            void actions.install(h);
        } else if (b.phase === "installed" && !started.has(`sign-in:${h}`)) {
            started.add(`sign-in:${h}`);
            void actions.signIn(h);
        }
    });

    // the chosen brain's own models; a model belongs to its harness, so another brain is chosen afresh
    const models = createModels(agent, () => (brainReady() ? props.harness() : undefined));
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

    // the Next button appears with the scene, so the way forward is always in
    // view, and it works once the scene's answer is in
    const ready = () => {
        if (!revealed()) return false;
        switch (wizard.currentStep()) {
            case STEP.name:
                return name().length > 0;
            case STEP.brain:
                return Boolean(props.harness());
            case STEP.signIn:
                return brainReady();
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
        wizard.setOptionsShown(revealed());
        wizard.setCanProceed(ready());
    });

    const scenes: Record<number, () => Promise<boolean>> = {
        [STEP.name]: () =>
            speaker.say(["[happy]Hi there! I'm your personal agent. I don't have a name yet though, that's your call."]),
        [STEP.brain]: () => speaker.say(scriptFor(name()).named(name())),
        [STEP.signIn]: () => speaker.say(scriptFor(name()).signIn),
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

    // the speaker glides when a step's content re-centers the column, instead of jumping
    let above: HTMLDivElement | undefined;
    let speakerEl: HTMLDivElement | undefined;
    onMount(() => {
        if (above) onCleanup(glideWhenRecentered(above, () => speakerEl));
    });

    return (
        <div class={styles.flow}>
            <div ref={above} class={styles.above} />
            <Show when={speakerShown()}>
                <div ref={speakerEl} class={styles.speaker} classList={{ [styles.leaving!]: leaving() }}>
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
                <Reveal when={revealed()} centered>
                    <PaperInput
                        ref={(el) => queueMicrotask(() => el.focus())}
                        label="Name"
                        placeholder={props.placeholder}
                        value={props.name()}
                        onInput={(e) => props.setName(e.currentTarget.value)}
                        maxLength={LIMITS.name}
                    />
                    {/* the suggestion is only a suggestion: say why Next waits */}
                    <Show when={props.name().length === 0}>
                        <PaperText preset="hint">Type a name to continue.</PaperText>
                    </Show>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.brain} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <PaperSelector name="harness" value={props.harness()} onValueChange={(v) => props.setHarness(v as Harness)}>
                        <For each={HARNESSES}>
                            {(h) => (
                                <PaperSelectorItem value={h} icon={<BrainLogo harness={h} />} description={harnessDescription(h)}>
                                    {harnessName(h)}
                                </PaperSelectorItem>
                            )}
                        </For>
                    </PaperSelector>
                    <PaperText preset="hint">
                        You can change this later.
                    </PaperText>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.signIn} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <Show when={props.harness()}>
                        {(h) => (
                            <>
                                <PaperSectionHeader title={harnessName(h())} role="heading" aria-level={2} />
                                <Show when={brainReady() || brain()?.phase === "installed"}>
                                    <PaperText preset="hint" inset>
                                        {brainLine(h(), brain()!)}
                                    </PaperText>
                                </Show>
                                <BrainStatus agent={agent} harness={h()} actions={actions} />
                                <BrainButtons agent={agent} harness={h()} actions={actions} onProviders={() => setProviders(true)} />
                            </>
                        )}
                    </Show>
                </Reveal>
            </PaperWizardStep>

            <PaperWizardStep class={styles.step} index={STEP.model} canProceed={ready()}>
                <Reveal when={revealed()}>
                    <PaperSectionHeader title="Choose a model" role="heading" aria-level={2} />
                    <Show when={(loadedModels(models)?.length ?? 0) >= SEARCH_MODELS_FROM}>
                        <PaperInput label="Search" icon="search" fullWidth placeholder="Search models" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
                    </Show>
                    <PaperSelector name="model" value={props.model()} onValueChange={(v) => props.setModel(String(v))}>
                        <PaperSelectorItem value={DEFAULT_MODEL} icon="tune" description="Whatever it's set to use already.">
                            Use {harnessName(props.harness() ?? "")}'s default
                        </PaperSelectorItem>
                        <For each={found()}>
                            {(m) => (
                                <PaperSelectorItem value={m.id} description={m.description ?? undefined}>
                                    {m.name}
                                </PaperSelectorItem>
                            )}
                        </For>
                    </PaperSelector>
                    <Show when={models.error}>
                        <PaperQuote variant="danger" icon="error" title="Models not listed" role="alert">
                            {errorText(models.error)} You can pick one later in settings.
                        </PaperQuote>
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
                        <PaperText preset="hint">
                            This computer can't run mine yet: {machine().error}
                        </PaperText>
                    </Show>
                </Reveal>
            </PaperWizardStep>

            {/* always there, so the computer's step is never taken for the last one before it's answered */}
            <PaperWizardStep class={styles.step} index={STEP.last} canProceed={ready()}>
                <Show when={props.computer() === "later" && props.saveError()}>
                    <PaperQuote variant="danger" icon="error" title="Settings not saved" role="alert">
                        {props.saveError()}
                    </PaperQuote>
                </Show>
                <Show when={props.computer() === "setup"}>
                    <Show when={revealed()}>
                        <div class={styles.install}>
                            <PaperSectionHeader title={`Setting up ${name()}'s computer`} role="heading" aria-level={2} />
                            <Switch>
                                <Match when={props.saveError()}>
                                    <PaperQuote variant="danger" icon="error" title="Setup not started" role="alert">
                                        {props.saveError()}
                                    </PaperQuote>
                                    <PaperButton disabled={props.saving()} onClick={() => void props.save()}>
                                        Try again
                                    </PaperButton>
                                </Match>
                                <Match when={true}>
                                    <SetupProgress computer={machine()} />
                                    <Show when={machine().phase === "failed" || machine().phase === "unsupported"}>
                                        <PaperFlex direction="row" wrap gap="full">
                                            <Show when={machine().phase === "failed"}>
                                                <PaperButton disabled={props.saving()} onClick={() => void props.save()}>
                                                    Try again
                                                </PaperButton>
                                            </Show>
                                            <PaperButton variant="text" onClick={props.onDone}>
                                                Chat without it for now
                                            </PaperButton>
                                        </PaperFlex>
                                    </Show>
                                </Match>
                            </Switch>
                        </div>
                    </Show>
                </Show>
            </PaperWizardStep>
            <div class={styles.below} />
            <Providers agent={agent} open={providers()} onClose={() => setProviders(false)} />
        </div>
    );
}

function Reveal(props: { when: boolean; centered?: boolean; children: JSX.Element }) {
    return (
        <Show when={props.when}>
            <div class={styles.reveal} classList={{ [styles.centered!]: props.centered }}>
                {props.children}
            </div>
        </Show>
    );
}
