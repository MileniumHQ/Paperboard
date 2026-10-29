import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { PaperButton, PaperFlex, PaperGrid, PaperMediaCard, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { panelPermissionsApi } from "../../lib/shell";
import type { PanelPermission, PermissionAsk, ScreenPick, SystemBlock } from "../../../../shared/panelPermissions";

const NOUNS: Record<PanelPermission, string> = {
    microphone: "microphone",
    camera: "camera",
    screen: "screen",
};

/** "microphone", "microphone and camera" */
export function permissionsText(permissions: PanelPermission[]): string {
    const nouns = permissions.map((p) => NOUNS[p]);
    return nouns.length <= 1 ? (nouns[0] ?? "") : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

const SYSTEM_PATHS: Record<SystemBlock["platform"], { name: string; settings: (what: string) => string }> = {
    darwin: { name: "macOS", settings: (what) => `System Settings → Privacy & Security → ${what}` },
    win32: { name: "Windows", settings: (what) => `Settings → Privacy & security → ${what}` },
};

const SYSTEM_SECTIONS: Record<PanelPermission, string> = {
    microphone: "Microphone",
    camera: "Camera",
    screen: "Screen & System Audio Recording",
};

type Question = { kind: "ask"; ask: PermissionAsk } | { kind: "pick"; pick: ScreenPick } | { kind: "system"; block: SystemBlock };

// What panels ask of you: whether one may use your microphone, camera or
// screen (asked once per panel, the answer kept), what screen to share, and
// when the system itself blocks Paperboard. One question at a time, in order.
const PanelPermissionPrompt: Component<{ panelName: (computerId: string, panelId: string) => string }> = (props) => {
    const [queue, setQueue] = createSignal<Question[]>([]);
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const current = () => queue()[0] ?? null;
    const push = (q: Question) => setQueue((list) => [...list, q]);
    const next = () => {
        setError(null);
        setQueue((list) => list.slice(1));
    };

    onMount(() => {
        const offs = [
            panelPermissionsApi.onAsk((ask) => push({ kind: "ask", ask })),
            panelPermissionsApi.onScreenPick((pick) => push({ kind: "pick", pick })),
            panelPermissionsApi.onSystemBlock((block) => push({ kind: "system", block })),
        ];
        onCleanup(() => offs.forEach((off) => off()));
    });

    const answer = async (askId: string, value: string | null) => {
        setBusy(true);
        try {
            await panelPermissionsApi.answer(askId, value);
            next();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const openSettings = async (permission: PanelPermission) => {
        try {
            await panelPermissionsApi.openSystemSettings(permission);
            next();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const failure = () => (
        <Show when={error()}>
            {(message) => (
                <PaperQuote variant="danger" icon="error" title="Your answer didn't go through" role="alert">
                    <PaperText breakWord>{message()}</PaperText>
                </PaperQuote>
            )}
        </Show>
    );

    const name = (q: { computerId: string; panelId: string } | null) => (q ? props.panelName(q.computerId, q.panelId) : "");

    // each modal stays mounted and keeps showing its last question while it
    // fades out; open says whether that question is the current one
    const asking = () => {
        const q = current();
        return q?.kind === "ask" ? q.ask : null;
    };
    const picking = () => {
        const q = current();
        return q?.kind === "pick" ? q.pick : null;
    };
    const blocked = () => {
        const q = current();
        return q?.kind === "system" ? q.block : null;
    };
    const [ask, setAsk] = createSignal<PermissionAsk | null>(null);
    const [pick, setPick] = createSignal<ScreenPick | null>(null);
    const [block, setBlock] = createSignal<SystemBlock | null>(null);
    createEffect(() => asking() && setAsk(asking()));
    createEffect(() => picking() && setPick(picking()));
    createEffect(() => blocked() && setBlock(blocked()));
    const system = () => SYSTEM_PATHS[block()?.platform ?? "darwin"];
    const blockedNoun = () => NOUNS[block()?.permission ?? "microphone"];

    return (
        <>
            <PaperModal
                open={asking() !== null}
                size="small"
                title={`Let ${name(ask())} use your ${permissionsText(ask()?.permissions ?? [])}?`}
                onClose={() => void answer(ask()!.askId, null)}
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy()} onClick={() => void answer(ask()!.askId, "denied")}>
                            Don't allow
                        </PaperButton>
                        <PaperButton disabled={busy()} onClick={() => void answer(ask()!.askId, "allowed")}>
                            Allow
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText>Paperboard remembers your answer for {name(ask())}. You can change it in App Settings.</PaperText>
                    {failure()}
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={picking() !== null}
                size="large"
                title={`Share with ${name(pick())}`}
                onClose={() => void answer(pick()!.askId, null)}
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy()} onClick={() => void answer(pick()!.askId, null)}>
                            Cancel
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <PaperText>Choose a screen or window. {name(pick())} sees it until it stops sharing.</PaperText>
                    {failure()}
                    <PaperGrid>
                        <For each={pick()?.sources ?? []}>
                            {(source) => (
                                <PaperMediaCard
                                    banner={source.thumbnail}
                                    bannerAlt=""
                                    title={source.name}
                                    interactive
                                    disabled={busy()}
                                    onClick={() => void answer(pick()!.askId, source.id)}
                                />
                            )}
                        </For>
                    </PaperGrid>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={blocked() !== null}
                size="small"
                title={`${system().name} is blocking the ${blockedNoun()}`}
                onClose={next}
                footer={
                    <>
                        <PaperButton variant="text" onClick={next}>
                            Close
                        </PaperButton>
                        <PaperButton onClick={() => void openSettings(block()!.permission)}>Open settings</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText>
                        {name(block())} asked for your {blockedNoun()}, but {system().name} isn't letting Paperboard use it. Turn on Paperboard in{" "}
                        {system().settings(SYSTEM_SECTIONS[block()?.permission ?? "microphone"])}, then try again.
                    </PaperText>
                    {failure()}
                </PaperFlex>
            </PaperModal>
        </>
    );
};

export default PanelPermissionPrompt;
