import { type Component, createSignal, createEffect, on, Show, For, Index, onCleanup, batch } from "solid-js";
import {
    PaperWizard,
    PaperWizardStep,
    PaperSelector,
    PaperSelectorItem,
    PaperInput,
    PaperFlex,
    PaperQuote,
    PaperText,
    PaperButton,
    PaperError,
    PaperLoader,
    PaperLoaderGroup,
    useWizard,
    createRead,
    showError,
    showToast,
} from "@mileniumhq/paperui";
import {
    computersApi as computers,
    computerSetupApi,
    discoveryApi,
    logToMain,
    type ComputerSetupState,
    type DiscoveredComputer,
} from "../../lib/shell";
import frameStyles from "./wizardFrame.module.css";
import { DAEMON_PORT } from "../../lib/daemonPort";
import { errorMessage } from "@mileniumhq/paperapi";

export interface ComputerSetupWizardProps {
    onClose: () => void;
    onComplete: (computer: { id: string }) => void;
}

// the wizard's steps; a listed computer skips DETAILS, and one without SSH skips SETUP
const CHOOSE = 0;
const DETAILS = 1;
const SETUP = 2;
const CODE = 3;

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
    // whether SSH answers there too: then the computer is set up over SSH
    const ssh = createRead(({ host }) => computerSetupApi.sshCheck(host), { source: checking });
    const sshAvailable = () => !ssh.loading() && ssh.error() === null && ssh.value()?.ssh === true;
    // a check that can't run (an ssh config it can't read) says why where the
    // address is, for as long as it holds, or SSH setup would just not be offered
    const SshProblem: Component = () => (
        <Show when={ssh.error()}>
            {(err) => <PaperError title="Couldn't check for SSH" error={err()} />}
        </Show>
    );
    // a computer picked from the nearby list counts as reachable while it is checked
    const [picked, setPicked] = createSignal(false);
    const answered = () => !probe.loading() && (probe.value() !== undefined || probe.error() !== null);
    const isReachable = () => (answered() ? !probe.error() && Boolean(probe.value()?.reachable) : picked() && probe.loading());
    const probeUnreachable = () => answered() && !isReachable();
    // the probe's typed error carries the real reason (refused / timeout /
    // unknown host); losing it turned every failure into "check the address"
    const probeDetail = () => probe.error() ?? probe.value()?.error ?? "";
    // no address was reached, so the port is left out of the message
    const unreachableWords = () =>
        `Can't reach ${host().trim()}${probeInvalid() ? "" : `:${port().trim() || DAEMON_PORT}`}${probeDetail() ? `. ${probeDetail()}` : ""}`;
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
        ssh.set(undefined);
        const host = target?.host.trim();
        if (host) setChecking({ host, port: target!.port.trim() });
    };
    // an address being typed is checked once the typing pauses
    const probeTyped = (targetHost: string, targetPort: string) => {
        setPicked(false);
        probeTarget(null);
        if (targetHost.trim().length >= 3) probeTimeout = setTimeout(() => probeTarget({ host: targetHost, port: targetPort }), 400);
    };

    // an address typed with its port ("192.168.1.50:45464", "[::1]:45464"),
    // as `papercrane pair` prints it, fills both fields
    const handleIpInput = (val: string) => {
        const withPort = /^\s*(\[[^\]]*\]|[^:\s]+):(\d{1,5})\s*$/.exec(val);
        if (withPort) {
            setHost(withPort[1]!);
            setPort(withPort[2]!);
            probeTyped(withPort[1]!, withPort[2]!);
            return;
        }
        setHost(val);
        probeTyped(val, port());
    };

    const handlePortInput = (val: string) => {
        setPort(val);
        probeTyped(host(), val);
    };

    // the code as the daemon prints it: two groups of three digits
    const handleCodeInput = (field: HTMLInputElement) => {
        const digits = field.value.replace(/\D/g, "").slice(0, 6);
        const grouped = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
        // a key that changes nothing (a letter) is taken back out of the field too
        field.value = grouped;
        setCode(grouped);
    };

    // ── setting up over SSH ──
    const [setup, setSetup] = createSignal<ComputerSetupState | null>(null);
    const [username, setUsername] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [signingIn, setSigningIn] = createSignal(false);
    // why the pairing code is the way left, shown on the code step
    const [codeHint, setCodeHint] = createSignal("");
    let jobId: string | null = null;
    // a start the wizard has since left (or started again) is cancelled when it answers
    let startToken = 0;
    // pushes that came before the start's answer named their job: the newest is kept
    let early: ComputerSetupState | null = null;
    // the newer state of the job this wizard started; anything else goes nowhere
    const take = (state: ComputerSetupState) => {
        if (state.jobId !== jobId) return;
        const shown = setup();
        if (shown?.jobId === state.jobId && shown.revision >= state.revision) return;
        setSetup(state);
    };
    onCleanup(computerSetupApi.onChanged((state) => {
        if (jobId === null && startToken > 0 && (!early || early.jobId !== state.jobId || early.revision < state.revision)) early = state;
        take(state);
    }));
    const cancelJob = (id: string) => {
        void computerSetupApi.cancel(id).catch((err) => showError("Couldn't stop setting up the computer", err));
    };
    const startSetup = () => {
        const token = ++startToken;
        jobId = null;
        early = null;
        batch(() => {
            setSetup(null);
            setPassword("");
            // each computer asks with its own account (its ~/.ssh/config User)
            setUsername("");
            setSigningIn(false);
        });
        const target = host().trim();
        computerSetupApi.start(target).then(
            (started) => {
                if (token !== startToken) return cancelJob(started.jobId);
                jobId = started.jobId;
                take(started);
                if (early) take(early);
                early = null;
            },
            (err) => {
                if (token !== startToken) return;
                setSetup({ jobId: "", revision: 0, host: target, steps: [], signIn: null, result: { failed: errorMessage(err) } });
            },
        );
    };
    const stopSetup = () => {
        startToken++;
        early = null;
        setSetup(null);
        if (!jobId) return;
        const id = jobId;
        jobId = null;
        cancelJob(id);
    };
    onCleanup(stopSetup);
    const signIn = async () => {
        const state = setup();
        if (!state?.signIn || !jobId) return;
        setSigningIn(true);
        try {
            await computerSetupApi.signIn(jobId, username().trim(), password());
            setPassword("");
        } finally {
            setSigningIn(false);
        }
    };
    // what stopped the setup, when something did
    const failure = () => {
        const result = setup()?.result;
        return result && "failed" in result ? result.failed : null;
    };
    createEffect(on(() => setup()?.signIn?.username, (asked) => {
        if (asked !== undefined && !username()) setUsername(asked);
    }));

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

    // the step after choosing the computer (and its address): SSH sets it up, else its code pairs it
    const afterAddress = () => (sshAvailable() ? SETUP : CODE);
    // moves the wizard from outside it; set once it is up
    let goTo: ((step: number) => void) | undefined;

    // Routes the wizard's Next and Back: a listed computer skips its
    // address, and one without SSH skips the setup
    const WizardStepRouter: Component = () => {
        const wizard = useWizard();
        let previousStep = CHOOSE;

        if (!wizard) return null;
        const go = (to: number) => {
            previousStep = to;
            wizard.setCurrentStep(to);
        };
        goTo = go;
        // the step before the setup or the code: the address, or the list
        const beforeConnecting = () => (method() === "custom" ? DETAILS : CHOOSE);
        createEffect(on(wizard.currentStep, (step) => {
            const prev = previousStep;
            previousStep = step;
            // a move go() made itself: already routed
            if (step === prev) return;
            const forward = step > prev;
            if (prev === SETUP) stopSetup();
            if (forward) {
                if (prev === CHOOSE && step === DETAILS && method() !== "custom") go(afterAddress());
                else if (prev === DETAILS && step === SETUP) go(afterAddress());
                return;
            }
            if (step === DETAILS && method() !== "custom") go(CHOOSE);
            else if (prev === CODE && step === SETUP) go(beforeConnecting());
            else if (prev === SETUP) go(beforeConnecting());
        }));
        // the setup ends on its own: paired goes to the computer, the code is the way left goes to the code step
        createEffect(on(() => setup()?.result, (result) => {
            if (!result) return;
            // the setup is over: nothing is left to cancel
            jobId = null;
            if ("paired" in result) {
                props.onComplete({ id: result.paired.id });
                props.onClose();
                // said where it outlives the wizard
                if (result.paired.notice) showToast({ variant: "warning", title: `${name() || host()} is added`, message: result.paired.notice });
            } else if ("useCode" in result) {
                setCodeHint(result.useCode);
                go(CODE);
            }
        }));

        return null;
    };

    return (
        <PaperWizard
            onComplete={handleFinish}
            nextLabel={setup()?.signIn ? "Sign In" : undefined}
            finishLabel="Add Computer"
            finishVariant="success"
            class={frameStyles.wizard}
        >
            <WizardStepRouter />

            <PaperWizardStep index={CHOOSE} canProceed={method() !== ""}>
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

            <PaperWizardStep index={DETAILS} canProceed={isReachable() || sshAvailable()}>
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
                                Enter the address of a computer you can sign
                                in to over SSH, or one running the Paperboard
                                server daemon.
                            </PaperText>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                label="Computer address"
                                icon="language"
                                value={host()}
                                error={probeUnreachable() && !sshAvailable() && !ssh.loading() ? unreachableWords() : undefined}
                                onInput={(e) =>
                                    handleIpInput(e.currentTarget.value)
                                }
                            />

                            <PaperInput
                                fullWidth
                                label="Server port"
                                icon="numbers"
                                value={port()}
                                onInput={(e) =>
                                    handlePortInput(e.currentTarget.value)
                                }
                            />

                        </PaperFlex>
                        <SshProblem />
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep
                index={SETUP}
                canProceed={Boolean(setup()?.signIn) && username().trim() !== "" && password() !== "" && !signingIn()}
                onStepActive={startSetup}
                // Next is Sign In here; the setup moves on by itself once it is done
                onNext={() => {
                    void signIn().catch((err) => showError("Couldn't sign in over SSH", err));
                    return false;
                }}
            >
                <PaperFlex center fullWidth fullHeight padding="full">
                    <PaperFlex direction="column" gap="full" fullWidth maxWidth="panel-small">
                        {/* the steps say what it does; the dialog keeps its height for them */}
                        <PaperText preset="title">Setting Up {name() || host()}</PaperText>

                        <PaperLoaderGroup>
                            {/* a step shows once it starts, so the sign-in form has room below the
                                ones under way; once it fails, only the step that failed stays beside
                                the error. Steps start in order, so a row keeps its place (and its
                                loader) as each push brings the steps again */}
                            <Index each={(setup()?.steps ?? []).filter((step) => (failure() ? step.status === "error" : step.status !== "waiting"))}>
                                {(step) => (
                                    <PaperLoader
                                        percent={step().percent}
                                        // a step that can't say how far it is spins
                                        loaderStatus={step().status === "loading" && step().percent === undefined ? "indeterminate" : step().status}
                                        label={step().status === "loading" ? `${step().label}...` : step().label}
                                    />
                                )}
                            </Index>
                        </PaperLoaderGroup>

                        <Show when={setup()?.signIn}>
                            {(asked) => (
                                <PaperFlex direction="column" gap="half">
                                    <PaperInput
                                        fullWidth
                                        label="Username"
                                        icon="person"
                                        autocomplete="username"
                                        value={username()}
                                        onInput={(e) => setUsername(e.currentTarget.value)}
                                    />
                                    <PaperInput
                                        fullWidth
                                        type="password"
                                        label="Password"
                                        icon="key"
                                        autocomplete="current-password"
                                        autofocus
                                        value={password()}
                                        onInput={(e) => setPassword(e.currentTarget.value)}
                                        error={asked().error}
                                    />
                                </PaperFlex>
                            )}
                        </Show>

                        <Show when={failure()}>
                            {(failed) => (
                                <PaperError
                                    title={`Couldn't set up ${name() || host()}`}
                                    error={failed()}
                                    action={{ label: "Try Again", onClick: startSetup }}
                                />
                            )}
                        </Show>

                        {/* the code is one click away whatever the setup is doing, failed included */}
                        <PaperFlex>
                            <PaperButton variant="text" size="small" onClick={() => {
                                stopSetup();
                                setCodeHint("");
                                goTo?.(CODE);
                            }}>
                                Connect with pairing code
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={CODE} canProceed={canProceedFromStep2()}>
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
                            <Show when={codeHint()}>
                                <PaperText preset="hint">{codeHint()}</PaperText>
                            </Show>
                            <Show when={!codeHint() && sshAvailable() && probeUnreachable()}>
                                <PaperText preset="hint">
                                    Paperboard Server isn't running there yet. On that computer, run
                                    npx @mileniumhq/paperboard install-service, then
                                    npx @mileniumhq/paperboard pair for the code.
                                </PaperText>
                            </Show>
                        </PaperFlex>
                        <SshProblem />

                        <PaperFlex direction="column" gap="half">
                            <PaperInput
                                fullWidth
                                label="Pairing code"
                                icon="lock"
                                autofocus
                                value={code()}
                                onInput={(e) => handleCodeInput(e.currentTarget)}
                                disabled={isPairing()}
                                error={pairError() || undefined}
                            />
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperWizardStep>
        </PaperWizard>
    );
};

export default ComputerSetupWizard;
