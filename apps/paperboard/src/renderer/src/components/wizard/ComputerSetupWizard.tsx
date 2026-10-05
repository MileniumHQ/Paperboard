import { type Component, createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import {
    PaperWizard,
    PaperWizardStep,
    PaperSelector,
    PaperSelectorItem,
    PaperInput,
    PaperFlex,
    PaperText,
    useWizard,
} from "@mileniumhq/paperui";
import {
    computersApi as computers,
    discoveryApi,
    type DiscoveredComputer,
} from "../../lib/shell";

export interface ComputerSetupWizardProps {
    onClose: () => void;
    onComplete: (computer: any) => void;
}

export const ComputerSetupWizard: Component<ComputerSetupWizardProps> = (
    props,
) => {
    const [method, setMethod] = createSignal("custom");
    const [host, setHost] = createSignal("");
    const [port, setPort] = createSignal("45464");
    const [name, setName] = createSignal("");
    const [code, setCode] = createSignal("");

    const [isReachable, setIsReachable] = createSignal(false);
    const [probeUnreachable, setProbeUnreachable] = createSignal(false);
    // the probe's typed error carries the real reason (refused / timeout /
    // unknown host); losing it turned every failure into "check the address"
    const [probeDetail, setProbeDetail] = createSignal("");
    const [isPairing, setIsPairing] = createSignal(false);
    const [pairError, setPairError] = createSignal("");

    const [discovered, setDiscovered] = createSignal<DiscoveredComputer[]>([]);

    const suggestionKey = (c: { host: string; port: number }) =>
        `${c.host}:${c.port}`;

    onMount(() => {
        discoveryApi.list().then((list) => {
            setDiscovered(list ?? []);
        });
        const off = discoveryApi.onChanged((list) => {
            setDiscovered(list ?? []);
        });
        onCleanup(() => off());
    });

    let probeTimeout: any;
    let lastAutoName = "";

    // the probe timer must not fire past this component's lifecycle
    onCleanup(() => clearTimeout(probeTimeout));

    const probeTarget = async (targetHost: string, targetPort: string) => {
        const trimmedHost = targetHost.trim();
        const trimmedPort = targetPort.trim();
        if (!trimmedHost) {
            setIsReachable(false);
            setProbeUnreachable(false);
            setProbeDetail("");
            return;
        }

        try {
            const res = await computers.probe(
                trimmedHost,
                Number(trimmedPort) || 45464,
            );

            if (res && res.reachable) {
                setIsReachable(true);
                setProbeUnreachable(false);
                setProbeDetail("");
                const rawName = (res.hostname || trimmedHost)
                    .replace(/\.local$/i, "")
                    .trim();
                if (!name().trim() || name() === lastAutoName) {
                    setName(rawName);
                    lastAutoName = rawName;
                }
            } else {
                setIsReachable(false);
                setProbeUnreachable(true);
            }
        } catch (err: any) {
            setIsReachable(false);
            setProbeUnreachable(true);
            setProbeDetail(String(err?.message ?? err));
        }
    };

    const handleIpInput = (val: string) => {
        setHost(val);
        setIsReachable(false);
        setProbeUnreachable(false);
        clearTimeout(probeTimeout);
        if (val.trim().length >= 3) {
            probeTimeout = setTimeout(() => {
                void probeTarget(val, port());
            }, 400);
        }
    };

    const handlePortInput = (val: string) => {
        setPort(val);
        setIsReachable(false);
        setProbeUnreachable(false);
        clearTimeout(probeTimeout);
        if (host().trim().length >= 3) {
            probeTimeout = setTimeout(() => {
                void probeTarget(host(), val);
            }, 400);
        }
    };

    const canProceedFromStep2 = () => {
        return code().replace(/\s+/g, "").length === 6 && !isPairing();
    };

    const handleFinish = async () => {
        setIsPairing(true);
        setPairError("");
        try {
            const res = await computers.pair(
                host().trim(),
                Number(port()) || 45464,
                code().trim(),
                name().trim() || undefined,
            );

            if (res && res.id) {
                props.onComplete(res);
                props.onClose();
            }
        } catch (err: any) {
            setPairError(
                err?.message ||
                    "Pairing failed. Make sure the 6-digit code is correct.",
            );
        } finally {
            setIsPairing(false);
        }
    };

    const handleMethodChange = (val: string) => {
        setMethod(val);
        if (val === "custom") {
            setHost("");
            setPort("45464");
            setName("");
            setIsReachable(false);
            setProbeUnreachable(false);
            return;
        }
        const s = discovered().find((d) => suggestionKey(d) === val);
        if (s) {
            setHost(s.host);
            setPort(String(s.port));
            const cleanName = s.name.replace(/\.local$/i, "").trim();
            setName(cleanName || s.host);
            setIsReachable(true);
            setProbeUnreachable(false);
            void probeTarget(s.host, String(s.port));
        }
    };

    let hasAutoSelected = false;
    createEffect(() => {
        const list = discovered();
        if (list.length > 0 && !hasAutoSelected && method() === "custom" && !host()) {
            hasAutoSelected = true;
            const first = list[0];
            handleMethodChange(suggestionKey(first));
        }
    });

    // Helper inside PaperWizard to seamlessly skip the IP step for discovered computers
    const WizardStepRouter: Component = () => {
        const wizard = useWizard();
        let previousStep = 0;

        createEffect(() => {
            if (!wizard) return;
            const step = wizard.currentStep();
            const prev = previousStep;
            previousStep = step;

            if (method() !== "custom") {
                // Forward navigation from Step 0 -> Step 1: skip directly to Step 2 (Pairing)
                if (prev === 0 && step === 1) {
                    wizard.setCurrentStep(2);
                }
                // Backward navigation from Step 2 -> Step 1: skip back to Step 0 (Method choice)
                else if (prev === 2 && step === 1) {
                    wizard.setCurrentStep(0);
                }
            }
        });

        return null;
    };

    return (
        <PaperWizard
            onComplete={handleFinish}
            finishLabel="Add Computer"
            finishVariant="success"
            style={{ width: "100%", height: "28rem" }}
        >
            <WizardStepRouter />

            <PaperWizardStep index={0}>
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex
                        direction="column"
                        gap="full"
                        style={{ width: "100%", "max-width": "26rem" }}
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Connect a Computer
                            </PaperText>
                            <PaperText preset="body">
                                Select how you want to discover and pair with
                                your computer.
                            </PaperText>
                        </PaperFlex>

                        <PaperSelector
                            name="connection-method"
                            value={method()}
                            onValueChange={(val) =>
                                handleMethodChange(String(val))
                            }
                        >
                            <For each={discovered()}>
                                {(s) => (
                                    <PaperSelectorItem
                                        value={suggestionKey(s)}
                                        icon="desktop_windows"
                                        description={`${s.host}:${s.port}`}
                                    >
                                        {s.name.replace(/\.local$/i, "")}
                                    </PaperSelectorItem>
                                )}
                            </For>
                            <PaperSelectorItem
                                value="custom"
                                icon="router"
                                description="Manually type an IP address for a computer not shown here."
                            >
                                Custom IP
                            </PaperSelectorItem>
                        </PaperSelector>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={isReachable()}>
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex
                        direction="column"
                        gap="full"
                        style={{ width: "100%", "max-width": "26rem" }}
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Computer Details
                            </PaperText>
                            <PaperText preset="body">
                                Enter the IP address of a computer running
                                the Paperboard server daemon.
                            </PaperText>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                placeholder="192.168.1.50"
                                aria-label="Computer address"
                                icon="language"
                                value={host()}
                                onInput={(e) =>
                                    handleIpInput(e.currentTarget.value)
                                }
                            />

                            <PaperInput
                                fullWidth
                                placeholder="45464"
                                aria-label="Server port"
                                icon="numbers"
                                value={port()}
                                onInput={(e) =>
                                    handlePortInput(e.currentTarget.value)
                                }
                            />

                            <Show when={probeUnreachable()}>
                                <PaperText size={2} color="danger">
                                    Can't reach {host().trim()}:
                                    {port().trim() || "45464"}. Check the
                                    address
                                    <Show when={probeDetail()}>
                                        <br />
                                        {probeDetail()}
                                    </Show>
                                </PaperText>
                            </Show>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={2} canProceed={canProceedFromStep2()}>
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex
                        direction="column"
                        gap="full"
                        style={{ width: "100%", "max-width": "26rem" }}
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Pairing Verification
                            </PaperText>
                            <PaperText preset="body">
                                Enter the 6-digit pairing code shown by the
                                Paperboard server daemon on{" "}
                                {name() || host() || "the target computer"}.
                            </PaperText>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                placeholder="123 456"
                                aria-label="Pairing code"
                                icon="lock"
                                value={code()}
                                onInput={(e) => setCode(e.currentTarget.value)}
                                disabled={isPairing()}
                            />

                            <Show when={pairError()}>
                                <PaperText size={2} color="danger">
                                    {pairError()}
                                </PaperText>
                            </Show>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>
        </PaperWizard>
    );
};

export default ComputerSetupWizard;
