import { type Component, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    getVarCss,
} from "@mileniumhq/paperui";
import type { TutorialStep } from "@mileniumhq/paperapi";

export interface PanelTutorialProps {
    /** the panel whose tutorial is open; null when none is */
    panel: { name: string; tutorial: TutorialStep[] } | null;
    /** finished or dismissed: either way it has been shown */
    onDone: () => void;
}

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
                                <PaperFlex center fullWidth fullHeight padding="full">
                                    <PaperFlex
                                        direction="column"
                                        gap="full"
                                        style={{ width: "100%", "max-width": getVarCss("size-panel-small") }}
                                    >
                                        <Show when={step.icon}>
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
