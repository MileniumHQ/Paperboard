import { PaperButton } from "../../components/PaperButton";
import { PaperIcon } from "../../components/PaperIcon";
import { PaperEffect } from "../../components/PaperEffect";
import { PaperPresence } from "../../components/PaperPresence";
import type { PaperButtonVariant, PaperRole } from "../../types";
import { PaperText } from "../../components/PaperText";
import styles from "./index.module.css";
import {
    type JSX,
    createSignal,
    Show,
    For,
    createContext,
    useContext,
    createEffect,
    splitProps,
    type ParentProps,
} from "solid-js";

export interface PaperWizardProps extends JSX.HTMLAttributes<HTMLFormElement> {
    initialData?: Record<string, any>;
    onComplete?: (data: Record<string, any>) => void;
    onStepChange?: (stepIndex: number, data: Record<string, any>) => void;
    showProgress?: boolean;
    hideBack?: boolean;
    finishLabel?: JSX.Element | string;
    finishVariant?: PaperButtonVariant;
    nextLabel?: JSX.Element | string;
    backLabel?: JSX.Element | string;
}

export interface PaperWizardStepProps extends JSX.HTMLAttributes<HTMLDivElement> {
    name?: string;
    index: number;
    canProceed?: boolean;
    /** no Back button on this step, for one that can't be undone (a download that is done) */
    hideBack?: boolean;
    onStepActive?: () => void;
}

export interface WizardContextType {
    currentStep: () => number;
    totalSteps: () => number;
    setCurrentStep: (index: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    setStepData: (keyOrObject: string | Record<string, any>, value?: any) => void;
    getStepData: (key?: string) => any;
    getAllData: () => Record<string, any>;
    optionsShown: () => boolean;
    setOptionsShown: (show: boolean) => void;
    setCanProceed: (canProceed: boolean) => void;
    setBackHidden: (hidden: boolean) => void;
    isLastStep: () => boolean;
    isFirstStep: () => boolean;
    registerStep: (index: number) => void;
}

const WizardContext = createContext<WizardContextType>();
export const useWizard = () => useContext(WizardContext);

export function PaperWizard(props: ParentProps<PaperWizardProps>) {
    const [local, rest] = splitProps(props, [
        "initialData",
        "onComplete",
        "onStepChange",
        "showProgress",
        "hideBack",
        "finishLabel",
        "finishVariant",
        "nextLabel",
        "backLabel",
        "class",
        "classList",
        "children",
    ]);

    const [currentStep, setCurrentStep] = createSignal(0);
    const [totalSteps, setTotalSteps] = createSignal(1);
    const [optionsShown, setOptionsShown] = createSignal(true);
    const [canProceedCurrent, setCanProceedCurrent] = createSignal(true);
    const [backHiddenCurrent, setBackHiddenCurrent] = createSignal(false);

    const [wizardData, setWizardData] = createSignal<Record<string, any>>({
        ...(local.initialData || {}),
    });

    const registerStep = (index: number) => {
        setTotalSteps((prev) => Math.max(prev, index + 1));
    };

    const setStepData = (keyOrObject: string | Record<string, any>, value?: any) => {
        setWizardData((prev) => {
            if (typeof keyOrObject === "string") {
                return { ...prev, [keyOrObject]: value };
            }
            return { ...prev, ...keyOrObject };
        });
    };

    const getStepData = (key?: string) => {
        const data = wizardData();
        return key ? data[key] : data;
    };

    const isFirstStep = () => currentStep() === 0;
    const isLastStep = () => currentStep() >= totalSteps() - 1;

    const nextStep = () => {
        if (!canProceedCurrent()) return;

        if (isLastStep()) {
            const finalData = wizardData();
            local.onComplete?.(finalData);
        } else {
            const nextIdx = currentStep() + 1;
            setCurrentStep(nextIdx);
            local.onStepChange?.(nextIdx, wizardData());
        }
    };

    let formRef: HTMLFormElement | undefined;

    // What the current step's fields hold. A checkbox (a PaperToggle's too)
    // gives its checked boolean, so an unchecked one records false instead
    // of leaving the key out; every other field gives what FormData gives.
    const collectForm = (form: HTMLFormElement) => {
        const harvested: Record<string, any> = { ...wizardData() };
        new FormData(form).forEach((val, key) => {
            harvested[key] = val;
        });
        for (const el of Array.from(form.elements)) {
            if (el instanceof HTMLInputElement && el.type === "checkbox" && el.name && !el.disabled) {
                harvested[el.name] = el.checked;
            }
        }
        setStepData(harvested);
    };

    const prevStep = () => {
        if (!isFirstStep()) {
            // the step's fields unmount when it leaves: keep what they hold
            if (formRef) collectForm(formRef);
            const prevIdx = currentStep() - 1;
            setCurrentStep(prevIdx);
            local.onStepChange?.(prevIdx, wizardData());
        }
    };

    const handleFormSubmit = (e: SubmitEvent) => {
        e.preventDefault();
        collectForm(e.currentTarget as HTMLFormElement);

        nextStep();
    };

    const contextValue: WizardContextType = {
        currentStep,
        totalSteps,
        setCurrentStep,
        nextStep,
        prevStep,
        setStepData,
        getStepData,
        getAllData: () => wizardData(),
        optionsShown,
        setOptionsShown,
        setCanProceed: setCanProceedCurrent,
        setBackHidden: setBackHiddenCurrent,
        isLastStep,
        isFirstStep,
        registerStep,
    };

    const className = () =>
        [styles.PaperWizard, local.class].filter(Boolean).join(" ");

    const stepNumbers = () => Array.from({ length: totalSteps() }, (_, i) => i);

    // The finish glow light takes the button's color so the two never
    // disagree; a surface, text or outline variant has no role color to light
    // with, so it goes colorless.
    const finishEffect = (): { variant?: PaperRole; colorless?: boolean } => {
        if (!isLastStep()) return {};
        const variant = local.finishVariant ?? "success";
        return variant === "surface" || variant === "text" || variant === "outline" ? { colorless: true } : { variant };
    };

    return (
        <WizardContext.Provider value={contextValue}>
            <form ref={formRef} {...rest} class={className()} classList={local.classList} onSubmit={handleFormSubmit}>
                <div class={styles.wizardSteps}>
                    {local.children}
                </div>

                <div
                    class={styles.wizardOptions}
                    classList={{
                        [styles.optionsHidden]: !optionsShown(),
                    }}
                >
                    <div>
                        <Show when={!local.hideBack && !backHiddenCurrent() && !isFirstStep()}>
                            <PaperEffect colorless disabled={!optionsShown()}>
                                <PaperButton
                                    type="button"
                                    onClick={prevStep}
                                    disabled={!optionsShown()}
                                >
                                    <PaperIcon>arrow_back</PaperIcon>
                                    {local.backLabel ?? "Back"}
                                </PaperButton>
                            </PaperEffect>
                        </Show>
                    </div>

                    <Show when={local.showProgress ?? true}>
                        <div
                            class={styles.wizardDots}
                            role="progressbar"
                            aria-valuemin={1}
                            aria-valuemax={totalSteps()}
                            aria-valuenow={currentStep() + 1}
                            aria-valuetext={`Step ${currentStep() + 1} of ${totalSteps()}`}
                        >
                            <For each={stepNumbers()}>
                                {(i) => (
                                    <span
                                        class={styles.wizardDot}
                                        classList={{
                                            [styles.dotDone]: i < currentStep(),
                                            [styles.dotCurrent]: i === currentStep(),
                                        }}
                                    />
                                )}
                            </For>
                        </div>
                    </Show>

                    <div>
                        <PaperEffect
                            {...finishEffect()}
                            disabled={!optionsShown() || !canProceedCurrent()}
                        >
                            <PaperButton
                                type="submit"
                                variant={isLastStep() ? (local.finishVariant ?? "success") : undefined}
                                disabled={!optionsShown() || !canProceedCurrent()}
                            >
                                {isLastStep()
                                    ? local.finishLabel ?? "Finish"
                                    : local.nextLabel ?? "Next"}
                                <PaperIcon>
                                    {isLastStep() ? "check_circle" : "arrow_forward"}
                                </PaperIcon>
                            </PaperButton>
                        </PaperEffect>
                    </div>
                </div>
            </form>
        </WizardContext.Provider>
    );
}

export function PaperWizardStep(props: ParentProps<PaperWizardStepProps>) {
    const wizard = useWizard();
    const [local, rest] = splitProps(props, [
        "name",
        "index",
        "canProceed",
        "hideBack",
        "onStepActive",
        "class",
        "classList",
        "children",
    ]);

    createEffect(() => {
        wizard?.registerStep(local.index);
    });

    createEffect(() => {
        if (wizard?.currentStep() === local.index) {
            local.onStepActive?.();
            wizard.setBackHidden(local.hideBack ?? false);
            if (local.canProceed !== undefined) {
                wizard.setCanProceed(local.canProceed);
            } else {
                wizard.setCanProceed(true);
            }
        }
    });

    const isActive = () => wizard?.currentStep() === local.index;

    const className = () =>
        [styles.PaperWizardStep, local.class].filter(Boolean).join(" ");

    // the step leaving stays over the one arriving until it has faded, so a
    // step change crossfades instead of passing through an empty frame
    return (
        <PaperPresence when={isActive()} appear enterClass={styles.stepEnter} exitClass={styles.stepExit}>
            <div {...rest} class={className()} classList={local.classList} inert={!isActive()}>
                {local.children}
            </div>
        </PaperPresence>
    );
}
