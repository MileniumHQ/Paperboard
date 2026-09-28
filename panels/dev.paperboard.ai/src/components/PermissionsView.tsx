import { createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperCard, PaperEmptyState, PaperModal, PaperText } from "@paperboard-dev/paperui";
import { UI_ACTION_IDS } from "../contract";
import { actionLabel, loadPanelInfo, panelIcon, panelName } from "../lib/panels";
import { call, errorText, state } from "../lib/state";
import styles from "./PermissionsView.module.css";

function splitKey(key: string): { panelId: string; action: string } {
    const i = key.indexOf(":");
    return { panelId: key.slice(0, i), action: key.slice(i + 1) };
}

/** Actions the AI may run without asking, and the way to take that back. */
export default function PermissionsView() {
    const [error, setError] = createSignal("");
    const [confirmAll, setConfirmAll] = createSignal(false);
    onMount(() => void loadPanelInfo());

    const revoke = async (key: string) => {
        setError("");
        try {
            await call(UI_ACTION_IDS.revokePermission, { key });
        } catch (err) {
            setError(errorText(err));
        }
    };

    return (
        <div class={styles.PermissionsView}>
            <div class={styles.intro}>
                <PaperText preset="subtitle">Always allowed actions</PaperText>
                <PaperText size={2} color="text-muted">
                    The AI asks before every action. When you choose Always allow, that action runs without asking in every chat until you revoke it here.
                </PaperText>
            </div>
            <Show when={error()}>
                <PaperText color="danger" role="alert">{error()}</PaperText>
            </Show>
            <PaperCard padding="full" gap="half" shrink={false}>
                <Show
                    when={state.alwaysAllowed.length > 0}
                    fallback={<PaperEmptyState icon="verified_user" title="Nothing is always allowed" description="Every action the AI wants to run will ask you first." />}
                >
                    <ul class={styles.list}>
                        <For each={state.alwaysAllowed}>
                            {(key) => {
                                const { panelId, action } = splitKey(key);
                                return (
                                    <li class={styles.row}>
                                        <img class={styles.icon} src={panelIcon(panelId)} alt="" />
                                        <div class={styles.text}>
                                            <PaperText size={2} weight={600} truncate>{actionLabel(panelId, action)}</PaperText>
                                            <PaperText size={1} color="text-muted" truncate>{panelName(panelId)}</PaperText>
                                        </div>
                                        <PaperButton size="small" onClick={() => revoke(key)} aria-label={`Revoke ${actionLabel(panelId, action)} in ${panelName(panelId)}`}>
                                            Revoke
                                        </PaperButton>
                                    </li>
                                );
                            }}
                        </For>
                    </ul>
                    <PaperButton variant="danger" class={styles.all} onClick={() => setConfirmAll(true)}>Revoke all</PaperButton>
                </Show>
            </PaperCard>
            <PaperModal
                open={confirmAll()}
                onClose={() => setConfirmAll(false)}
                title="Revoke every permission?"
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setConfirmAll(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" onClick={async () => { await revoke("*"); setConfirmAll(false); }}>Revoke all</PaperButton>
                    </>
                }
            >
                <PaperText>The AI will ask before every action again.</PaperText>
            </PaperModal>
        </div>
    );
}
