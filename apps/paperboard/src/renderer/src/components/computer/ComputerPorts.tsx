import { type Component, createEffect, For, on, Show } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText, PaperToggle, createRead, createSavedValue, showError } from "@mileniumhq/paperui";
import { portSettingsApi, type PortPolicy, type PortProtocol } from "@mileniumhq/paperapi";

const PROTOCOL_NAMES: Record<PortProtocol, string> = { tcp: "TCP", udp: "UDP", "tcp+udp": "TCP and UDP" };

// The Ports section of a computer's Computer Info: the network ports its
// panels hold, and what happens when one a panel asks for is taken.
const ComputerPorts: Component<{ computerId: string; shown: boolean }> = (props) => {
    const ports = createRead(
        async () => {
            const state = await portSettingsApi.all(props.computerId);
            return { claims: [...state.claims].sort((a, b) => a.port - b.port), policy: state.policy };
        },
        { failure: { title: "Couldn't load ports", retry: true } },
    );
    const policy = createSavedValue<PortPolicy>(() => ports.value()?.policy ?? "next-free", async (next) => {
        await portSettingsApi.setPolicy(next, props.computerId);
    });
    // the page stays mounted while hidden: the ports panels took meanwhile are read as it comes back into view
    createEffect(on(() => props.shown, (shown) => {
        if (shown) void ports.reload();
    }, { defer: true }));

    const setRefuse = (refuse: boolean) => {
        return policy.set(refuse ? "refuse" : "next-free").catch((err) => {
            showError("The setting was not saved", err);
        });
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperSectionHeader icon="lan" title="Ports" />

            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={ports.error()}>
                    <PaperEmptyState icon="error" title="Couldn't load">
                        <PaperButton disabled={ports.loading()} onClick={() => void ports.reload()}>Try again</PaperButton>
                    </PaperEmptyState>
                </Show>
                <Show when={ports.value()?.claims}>
                    {(list) => (
                        <>
                            <PaperSettingList autoHeight>
                                <PaperSettingItem
                                    title="Refuse taken ports"
                                    description="When a port a panel asks for is in use, show an error instead of giving it the next free one."
                                >
                                    <PaperToggle checked={policy.value() === "refuse"} onChange={setRefuse} />
                                </PaperSettingItem>
                            </PaperSettingList>
                            <Show
                                when={list().length > 0}
                                fallback={<PaperText preset="hint" inset>No panel holds a port on this computer.</PaperText>}
                            >
                                <PaperSettingList autoHeight>
                                    <For each={list()}>
                                        {(claim) => (
                                            <PaperSettingItem title={claim.label} description={PROTOCOL_NAMES[claim.protocol]}>
                                                <PaperText preset="label">{claim.port}</PaperText>
                                            </PaperSettingItem>
                                        )}
                                    </For>
                                </PaperSettingList>
                            </Show>
                        </>
                    )}
                </Show>
                <Show when={!ports.value() && !ports.error()}>
                    <PaperText preset="hint" inset>Loading ports…</PaperText>
                </Show>
            </PaperFlex>
        </PaperFlex>
    );
};

export default ComputerPorts;
