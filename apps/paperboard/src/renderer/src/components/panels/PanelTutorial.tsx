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
import { panelUrl } from "../../lib/shell";
import type { AppSettingsData } from "../settings/AppSettings";

export interface PanelTutorialProps {
    /** the panel whose tutorial is open, on the computer it was opened on; null when none is */
    panel: { computerId: string; id: string; name: string; tutorial: TutorialStep[] } | null;
    theme: AppSettingsData["darkMode"];
    /** finished or dismissed: either way it has been shown */
    onDone: () => void;
}

const isDark = (theme: AppSettingsData["darkMode"]) =>
    theme === "system" ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true : theme === "dark";

// A picture of the panel, from the panel's own build. One that won't load
// says so in its alt text rather than leaving an empty frame.
const StepImage: Component<{ src: string; image: TutorialImage }> = (props) => {
    const [failed, setFailed] = createSignal(false);
    const frame = {
        width: "420px",
        height: "315px",
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

// A panel's first-open tutorial: the steps its manifest declares, clicked
// through in the same wizard dialog that connects a computer.
const PanelTutorial: Component<PanelTutorialProps> = (props) => (
    <PaperModal
        open={props.panel !== null}
        aria-label={`Welcome to ${props.panel?.name ?? "this panel"}`}
        onClose={props.onDone}
        noHeader
        noPadding
        size="large"
    >
        <Show when={props.panel} keyed>
            {(panel) => (
                <PaperWizard
                    onComplete={props.onDone}
                    finishLabel="Get started"
                    finishVariant="success"
                    style={{ width: "100%", height: "var(--paperboard-wizard-height)" }}
                >
                    <For each={panel.tutorial}>
                        {(step, index) => (
                            <PaperWizardStep index={index()}>
                                <PaperFlex direction={step.image ? "row" : "column"} center fullWidth fullHeight padding="full" gap="full">
                                    <Show when={step.image}>
                                        {(image) => (
                                            <StepImage
                                                image={image()}
                                                src={panelUrl(panel.computerId, panel.id, (isDark(props.theme) && image().dark) || image().light)}
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

export default PanelTutorial;
