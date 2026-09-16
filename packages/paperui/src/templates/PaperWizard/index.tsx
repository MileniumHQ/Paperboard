import { PaperButton } from "../../components/PaperButton";
import { PaperIcon } from "../../components/PaperIcon";
import { PaperEffect } from "../../components/PaperEffect";
import type { PaperButtonVariant } from "../../types";
import { PaperText } from "../../components/PaperText";
import styles from "./index.module.css";
import {
    type JSX,
    createSignal,
    Show,
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

    const prevStep = () => {
        if (!isFirstStep()) {
            const prevIdx = currentStep() - 1;
            setCurrentStep(prevIdx);
            local.onStepChange?.(prevIdx, wizardData());
        }
    };

    const handleFormSubmit = (e: SubmitEvent) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget as HTMLFormElement);
        const harvested: Record<string, any> = { ...wizardData() };
        formData.forEach((val, key) => {
            harvested[key] = val;
        });
        setStepData(harvested);

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
        isLastStep,
        isFirstStep,
        registerStep,
    };

    const className = () =>
        [styles.PaperWizard, local.class].filter(Boolean).join(" ");

    const progressPercentage = () =>
        Math.min(100, Math.round(((currentStep() + 1) / totalSteps()) * 100));

    return (
        <WizardContext.Provider value={contextValue}>
            <form {...rest} class={className()} classList={local.classList} onSubmit={handleFormSubmit}>
                <div class={styles.wizardSteps}>
                    {local.children}
                </div>

                <div
                    class={styles.wizardOptions}
                    classList={{
                        [styles.optionsHidden]: !optionsShown(),
                    }}
                >
                    <Show when={local.showProgress ?? true}>
                        <div class={styles.wizardProgress}>
                            <div
                                class={styles.progressBar}
                                style={{ width: `${progressPercentage()}%` }}
                            ></div>
                        </div>
                    </Show>
                    <div>
                        <Show when={!local.hideBack && !isFirstStep()}>
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

                    <div>
                        <PaperEffect
                            variant={isLastStep() ? (local.finishVariant ?? "success") : undefined}
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

    return (
        <Show when={isActive()}>
            <div {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </Show>
    );
}
