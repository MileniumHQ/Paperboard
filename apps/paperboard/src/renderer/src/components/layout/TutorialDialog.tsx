import { type Component, createEffect, createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import type { TutorialImage, TutorialStep } from "@mileniumhq/paperapi";
import type { AppSettingsData } from "../settings/AppSettings";
import { createShownWhileClosing } from "../../lib/openings";
import frameStyles from "../wizard/wizardFrame.module.css";
import styles from "./TutorialDialog.module.css";

export interface OpenTutorial {
    /** what the tutorial welcomes you to: Paperboard, or a panel's name */
    name: string;
    steps: TutorialStep[];
    /** where a step's picture loads from: a panel's build, or the shell's own assets */
    imageSrc: (path: string) => string;
}

export interface TutorialDialogProps {
    /** null when no tutorial is open */
    tutorial: OpenTutorial | null;
    theme: AppSettingsData["darkMode"];
    /** finished or dismissed: either way it has been shown */
    onDone: () => void;
    /** the phone layout: a step's picture sits above its text, as wide as the screen */
    compact?: boolean;
}

const isDark = (theme: AppSettingsData["darkMode"]) =>
    theme === "system" ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true : theme === "dark";

// A step's picture. One that won't load
// says so in its alt text rather than leaving an empty frame.
const StepImage: Component<{ src: string; image: TutorialImage; compact?: boolean }> = (props) => {
    const [failed, setFailed] = createSignal(false);
    const picture = () => `${styles.picture} ${props.compact ? styles.compact : ""}`;
    return (
        <Show
            when={!failed()}
            fallback={
                <PaperFlex center padding="full" class={`${picture()} ${styles.missing}`}>
                    <PaperText preset="hint">
                        Picture unavailable: {props.image.alt}
                    </PaperText>
                </PaperFlex>
            }
        >
            <img src={props.src} alt={props.image.alt} onError={() => setFailed(true)} class={picture()} />
        </Show>
    );
};

// A first-open tutorial, Paperboard's own or the steps a panel's manifest
// declares, clicked through in the same wizard dialog that connects a computer.
const TutorialDialog: Component<TutorialDialogProps> = (props) => {
    const shown = createShownWhileClosing(() => props.tutorial);
    const pictureOf = (tutorial: OpenTutorial, image: TutorialImage) =>
        tutorial.imageSrc((isDark(props.theme) && image.dark) || image.light);
    // every step's picture loads as the tutorial opens, so a step crossfades
    // in whole instead of its picture arriving after its text
    createEffect(() => {
        const tutorial = props.tutorial;
        if (!tutorial) return;
        for (const step of tutorial.steps) {
            if (step.image) new Image().src = pictureOf(tutorial, step.image);
        }
    });
    return (
        <PaperModal
            open={props.tutorial !== null}
            aria-label={`Welcome to ${shown()?.value.name ?? "Paperboard"}`}
            onClose={props.onDone}
            noHeader
            noPadding
            size="large"
        >
            <Show when={shown()} keyed>
                {({ value: tutorial }) => (
                    <PaperWizard
                        onComplete={props.onDone}
                        finishLabel="Get started"
                        finishVariant="success"
                        class={frameStyles.wizard}
                    >
                        <For each={tutorial.steps}>
                            {(step, index) => (
                                <PaperWizardStep index={index()}>
                                    <PaperFlex direction={step.image && !props.compact ? "row" : "column"} center fullWidth fullHeight padding="full" gap="full">
                                        <Show when={step.image}>
                                            {(image) => (
                                                <StepImage
                                                    image={image()}
                                                    compact={props.compact}
                                                    src={pictureOf(tutorial, image())}
                                                />
                                            )}
                                        </Show>
                                        <PaperFlex
                                            direction="column"
                                            gap="full"
                                            fullWidth
                                            maxWidth="panel-small"
                                        >
                                            <Show when={!step.image && step.icon}>
                                                <PaperIcon class={styles.stepIcon}>
                                                    {step.icon}
                                                </PaperIcon>
                                            </Show>
                                            <PaperFlex direction="column" gap="half">
                                                <PaperText preset="title">{step.title}</PaperText>
                                                <PaperText preset="text">{step.body}</PaperText>
                                            </PaperFlex>
                                        </PaperFlex>
                                    </PaperFlex>
                                </PaperWizardStep>
                            )}
                        </For>
                    </PaperWizard>
                )}
            </Show>
        </PaperModal>
    );
};

export default TutorialDialog;
