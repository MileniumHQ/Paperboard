import { type Component, createSignal, createEffect, on, Show, For, onCleanup } from "solid-js";
import {
    PaperWizard,
    PaperWizardStep,
    PaperSelector,
    PaperSelectorItem,
    PaperInput,
    PaperFlex,
    PaperQuote,
    PaperText,
    useWizard,
    createRead,
} from "@mileniumhq/paperui";
import {
    computersApi as computers,
    discoveryApi,
    logToMain,
    type DiscoveredComputer,
} from "../../lib/shell";
import frameStyles from "./wizardFrame.module.css";
import { DAEMON_PORT } from "../../lib/daemonPort";
import { errorMessage } from "@mileniumhq/paperapi";

export interface ComputerSetupWizardProps {
    onClose: () => void;
    onComplete: (computer: { id: string }) => void;
}

export const ComputerSetupWizard: Component<ComputerSetupWizardProps> = (
    props,
) => {
    // nothing is chosen until the person chooses, or a computer is found
    const [method, setMethod] = createSignal("");
    const [host, setHost] = createSignal("");
    const [port, setPort] = createSignal(String(DAEMON_PORT));
    const [name, setName] = createSignal("");
    const [code, setCode] = createSignal("");

    const [isPairing, setIsPairing] = createSignal(false);
    const [pairError, setPairError] = createSignal("");

    // nearby computers: each update is the whole list again; reconciled by
    // id, a computer already listed keeps its row. A list that couldn't be
    // read says why; one can still be added by address
    const discovery = createRead(() => discoveryApi.list().then((list) => list ?? []), {
        follow: (land) => discoveryApi.onChanged((list) => land(list ?? [])),
    });
    const discovered = (): DiscoveredComputer[] => discovery.value() ?? [];
    const discoveryError = discovery.error;

    const suggestionKey = (c: { host: string; port: number }) =>
        `${c.host}:${c.port}`;

    let probeTimeout: ReturnType<typeof setTimeout> | undefined;
    let lastAutoName = "";
    // the address being checked; only the latest check answers for it: one
    // for an address that has since been changed is dropped, so Next can't
    // be enabled by a check of something other than what's typed
    const [checking, setChecking] = createSignal<{ host: string; port: string } | null>(null);
    // empty means the default; anything else is checked as typed
    const probe = createRead(({ host, port }) => computers.probe(host, port === "" ? undefined : port), { source: checking });
    // a computer picked from the nearby list counts as reachable while it is checked
    const [picked, setPicked] = createSignal(false);
    const answered = () => !probe.loading() && (probe.value() !== undefined || probe.error() !== null);
    const isReachable = () => (answered() ? !probe.error() && Boolean(probe.value()?.reachable) : picked() && probe.loading());
    const probeUnreachable = () => answered() && !isReachable();
    // the probe's typed error carries the real reason (refused / timeout /
    // unknown host); losing it turned every failure into "check the address"
    const probeDetail = () => probe.error() ?? probe.value()?.error ?? "";
    // no address was reached, so the port is left out of the message
    const probeInvalid = () => !probe.error() && probe.value()?.invalidAddress === true;
    // a computer that answers names itself, unless a name was typed
    createEffect(on(probe.value, (res) => {
        if (!res?.reachable) return;
        const rawName = (res.hostname || checking()?.host || "").replace(/\.local$/i, "").trim();
        if (!name().trim() || name() === lastAutoName) {
            setName(rawName);
            lastAutoName = rawName;
        }
    }));

    // the probe timer must not fire past this component's lifecycle
    onCleanup(() => clearTimeout(probeTimeout));

    /** forgets the last check, and checks `target` (trimmed) when there is one */
    const probeTarget = (target: { host: string; port: string } | null) => {
        clearTimeout(probeTimeout);
        setChecking(null);
        probe.set(undefined);
        const host = target?.host.trim();
        if (host) setChecking({ host, port: target!.port.trim() });
    };
    // an address being typed is checked once the typing pauses
    const probeTyped = (targetHost: string, targetPort: string) => {
        setPicked(false);
        probeTarget(null);
        if (targetHost.trim().length >= 3) probeTimeout = setTimeout(() => probeTarget({ host: targetHost, port: targetPort }), 400);
    };

    const handleIpInput = (val: string) => {
        setHost(val);
        probeTyped(val, port());
    };

    const handlePortInput = (val: string) => {
        setPort(val);
        probeTyped(host(), val);
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
                Number(port()) || DAEMON_PORT,
                code().trim(),
                name().trim() || undefined,
            );

            if (!res.id) throw new Error("The computer answered the pairing without saying who it is.");
            props.onComplete({ id: res.id });
            props.onClose();
        } catch (err) {
            logToMain("error", "Pairing a computer failed:", err);
            setPairError(errorMessage(err));
        } finally {
            setIsPairing(false);
        }
    };

    const handleMethodChange = (val: string) => {
        setMethod(val);
        setPicked(false);
        probeTarget(null);
        if (val === "custom") {
            setHost("");
            setPort(String(DAEMON_PORT));
            setName("");
            return;
        }
        const s = discovered().find((d) => suggestionKey(d) === val);
        if (s) {
            setHost(s.host);
            setPort(String(s.port));
            const cleanName = s.name.replace(/\.local$/i, "").trim();
            setName(cleanName || s.host);
            setPicked(true);
            probeTarget({ host: s.host, port: String(s.port) });
        }
    };

    let hasAutoSelected = false;
    createEffect(on(() => [...discovered()], (list) => {
        if (list.length > 0 && !hasAutoSelected && method() === "" && !host()) {
            hasAutoSelected = true;
            const first = list[0];
            handleMethodChange(suggestionKey(first));
        }
    }));

    // Helper inside PaperWizard to seamlessly skip the IP step for discovered computers
    const WizardStepRouter: Component = () => {
        const wizard = useWizard();
        let previousStep = 0;

        if (!wizard) return null;
        createEffect(on(wizard.currentStep, (step) => {
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
        }));

        return null;
    };

    return (
        <PaperWizard
            onComplete={handleFinish}
            finishLabel="Add Computer"
            finishVariant="success"
            class={frameStyles.wizard}
        >
            <WizardStepRouter />

            <PaperWizardStep index={0} canProceed={method() !== ""}>
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex
                        direction="column"
                        gap="full"
                        fullWidth
                        maxWidth="panel-small"
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Connect a Computer
                            </PaperText>
                            <PaperText preset="text">
                                Choose a computer found on your network, or
                                connect to one by its address.
                            </PaperText>
                        </PaperFlex>

                        <Show when={discoveryError()}>
                            <PaperQuote variant="warning" icon="wifi_find" title="Nearby computers not listed" role="alert">
                                {discoveryError()}. You can still connect by address.
                            </PaperQuote>
                        </Show>

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
                                description="Type the address of a computer that isn't listed."
                            >
                                Custom IP
                            </PaperSelectorItem>
                        </PaperSelector>

                        <Show when={!discoveryError() && discovered().length === 0}>
                            <PaperText preset="hint">
                                Looking for computers on your network. They show up here as they're found.
                            </PaperText>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={isReachable()}>
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex
                        direction="column"
                        gap="full"
                        fullWidth
                        maxWidth="panel-small"
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Computer Details
                            </PaperText>
                            <PaperText preset="text">
                                Enter the IP address of a computer running
                                the Paperboard server daemon.
                            </PaperText>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                label="Computer address"
                                placeholder="192.168.1.50"
                                icon="language"
                                value={host()}
                                onInput={(e) =>
                                    handleIpInput(e.currentTarget.value)
                                }
                            />

                            <PaperInput
                                fullWidth
                                label="Server port"
                                placeholder={String(DAEMON_PORT)}
                                icon="numbers"
                                value={port()}
                                onInput={(e) =>
                                    handlePortInput(e.currentTarget.value)
                                }
                            />

                            <Show when={probeUnreachable()}>
                                <PaperText preset="error">
                                    Can't reach {host().trim()}
                                    <Show when={!probeInvalid()}>
                                        :{port().trim() || DAEMON_PORT}
                                    </Show>
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
                        fullWidth
                        maxWidth="panel-small"
                    >
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">
                                Pairing Verification
                            </PaperText>
                            <PaperText preset="text">
                                Enter the 6-digit pairing code shown by the
                                Paperboard server daemon on{" "}
                                {name() || host() || "the target computer"}.
                            </PaperText>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                label="Pairing code"
                                placeholder="123 456"
                                icon="lock"
                                value={code()}
                                onInput={(e) => setCode(e.currentTarget.value)}
                                disabled={isPairing()}
                            />

                            <Show when={pairError()}>
                                <PaperText preset="error">
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
