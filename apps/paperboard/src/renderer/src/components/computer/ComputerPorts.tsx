import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { portSettingsApi, type PortClaim, type PortPolicy, type PortProtocol } from "@mileniumhq/paperapi";

const PROTOCOL_NAMES: Record<PortProtocol, string> = { tcp: "TCP", udp: "UDP", "tcp+udp": "TCP and UDP" };

// The Ports section of a computer's Computer Info: the network ports its
// panels hold, and what happens when one a panel asks for is taken.
const ComputerPorts: Component<{ computerId: string }> = (props) => {
    const [claims, setClaims] = createSignal<PortClaim[] | null>(null);
    const [policy, setPolicy] = createSignal<PortPolicy>("next-free");
    const [loadError, setLoadError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal("");

    const load = async () => {
        setLoadError("");
        try {
            const state = await portSettingsApi.all(props.computerId);
            setClaims([...state.claims].sort((a, b) => a.port - b.port));
            setPolicy(state.policy);
        } catch (err) {
            setClaims(null);
            setLoadError(`Ports could not be loaded: ${(err as Error)?.message ?? err}`);
        }
    };
    onMount(() => void load());

    const setRefuse = async (refuse: boolean) => {
        setSaving(true);
        setSaveError("");
        try {
            setPolicy(await portSettingsApi.setPolicy(refuse ? "refuse" : "next-free", props.computerId));
        } catch (err) {
            setSaveError(`The setting was not saved: ${(err as Error)?.message ?? err}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperSectionHeader icon="lan" title="Ports" />

            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={loadError()}>
                    <PaperCard accent="danger" padding="full">
                        <PaperFlex direction="row" gap="full" align="center" justify="space-between">
                            <PaperText size={2} color="danger">{loadError()}</PaperText>
                            <PaperButton onClick={() => void load()}>Try Again</PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </Show>
                <Show when={claims()}>
                    {(list) => (
                        <>
                            <PaperSettingList autoHeight>
                                <PaperSettingItem
                                    title="Refuse taken ports"
                                    description="When a port a panel asks for is in use, show an error instead of giving it the next free one."
                                >
                                    <PaperToggle checked={policy() === "refuse"} disabled={saving()} onChange={(checked) => void setRefuse(checked)} />
                                </PaperSettingItem>
                            </PaperSettingList>
                            <Show when={saveError()}>
                                <PaperText size={2} color="danger">{saveError()}</PaperText>
                            </Show>
                            <Show
                                when={list().length > 0}
                                fallback={<PaperText size={2} color="text-subtle">No panel holds a port on this computer.</PaperText>}
                            >
                                <PaperSettingList autoHeight>
                                    <For each={list()}>
                                        {(claim) => (
                                            <PaperSettingItem title={claim.label} description={PROTOCOL_NAMES[claim.protocol]}>
                                                <PaperText weight={700}>{claim.port}</PaperText>
                                            </PaperSettingItem>
                                        )}
                                    </For>
                                </PaperSettingList>
                            </Show>
                        </>
                    )}
                </Show>
                <Show when={!claims() && !loadError()}>
                    <PaperText size={2} color="text-subtle">Loading ports…</PaperText>
                </Show>
            </PaperFlex>
        </PaperFlex>
    );
};

export default ComputerPorts;
