import ProviderWizard from "./ProviderWizard";

export interface SetupProps {
    onComplete?: () => void;
}

/** First-run onboarding: adding the first provider. */
export default function Setup(props: SetupProps) {
    return <ProviderWizard finishLabel="Finish Setup" onDone={() => props.onComplete?.()} />;
}
