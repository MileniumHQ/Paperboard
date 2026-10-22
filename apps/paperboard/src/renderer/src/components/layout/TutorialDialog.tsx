import { type Component, createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    getVarCss,
} from "@mileniumhq/paperui";
import type { TutorialImage, TutorialStep } from "@mileniumhq/paperapi";
import type { AppSettingsData } from "../settings/AppSettings";

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
    const frame = {
        ...(props.compact
            ? { width: "100%", "max-width": getVarCss("size-panel-small"), "aspect-ratio": "4 / 3", height: "auto" }
            : { width: "420px", height: "315px" }),
        "flex-shrink": "0",
        "border-radius": getVarCss("border-radius"),
        border: `${getVarCss("border-width")} solid ${getVarCss("border")}`,
    };
    return (
        <Show
            when={!failed()}
            fallback={
                <PaperFlex center padding="full" style={{ ...frame, background: getVarCss("surface-inset") }}>
                    <PaperText preset="body" color="text-muted">
                        Picture unavailable: {props.image.alt}
                    </PaperText>
                </PaperFlex>
            }
        >
            <img src={props.src} alt={props.image.alt} onError={() => setFailed(true)} style={{ ...frame, display: "block", "object-fit": "cover" }} />
        </Show>
    );
};

// A first-open tutorial, Paperboard's own or the steps a panel's manifest
// declares, clicked through in the same wizard dialog that connects a computer.
const TutorialDialog: Component<TutorialDialogProps> = (props) => (
    <PaperModal
        open={props.tutorial !== null}
        aria-label={`Welcome to ${props.tutorial?.name ?? "Paperboard"}`}
        onClose={props.onDone}
        noHeader
        noPadding
        size="large"
    >
        <Show when={props.tutorial} keyed>
            {(tutorial) => (
                <PaperWizard
                    onComplete={props.onDone}
                    finishLabel="Get started"
                    finishVariant="success"
                    style={{ width: "100%", height: "var(--paperboard-wizard-height)" }}
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
                                                src={tutorial.imageSrc((isDark(props.theme) && image().dark) || image().light)}
                                            />
                                        )}
                                    </Show>
                                    <PaperFlex
                                        direction="column"
                                        gap="full"
                                        style={{ width: "100%", "max-width": getVarCss("size-panel-small") }}
                                    >
                                        <Show when={!step.image && step.icon}>
                                            <PaperIcon style={{ "align-self": "flex-start", "font-size": getVarCss("icon-size-huge"), color: getVarCss("primary") }}>
                                                {step.icon}
                                            </PaperIcon>
                                        </Show>
                                        <PaperFlex direction="column" gap="half">
                                            <PaperText preset="title">{step.title}</PaperText>
                                            <PaperText preset="body">{step.body}</PaperText>
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

export default TutorialDialog;
