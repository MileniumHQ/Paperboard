import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { serverBridge } from "../lib/server";
import { errorMessage } from "../lib/failure";
import { ACTION_IDS } from "../service/contract";
import type { AutomationView } from "../service/automation";

const OFF = "off";
const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const hourLabel = (hour: string) => new Date(2000, 0, 1, Number(hour.slice(0, 2))).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What the server does on its own, for every game: restart after a crash and once a day. */
export default function Automation() {
    const [view, setView] = createSignal<AutomationView | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");
    const [saving, setSaving] = createSignal(false);

    const load = async () => {
        setLoadError("");
        try {
            setView(await serverBridge.call<AutomationView>(ACTION_IDS.readAutomation));
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    onMount(() => void load());

    const save = async (patch: Partial<AutomationView>) => {
        setSaving(true);
        setSaveError("");
        try {
            setView(await serverBridge.call<AutomationView>(ACTION_IDS.writeAutomation, { patch }));
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="schedule" title="Automation" />
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read the automation settings">
                    <PaperFlex direction="column" gap="half">
                        <PaperText>{loadError()}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="Automation not saved" onDismiss={() => setSaveError("")}>
                    {saveError()}
                </PaperQuote>
            </Show>
            <Show
                when={view()}
                fallback={
                    <Show when={!loadError()}>
                        <PaperText size={2} color="text-subtle">Loading settings…</PaperText>
                    </Show>
                }
            >
                {(current) => (
                    <PaperSettingList autoHeight>
                        <PaperSettingItem
                            title="Restart after a crash"
                            description="Starts the server again a few seconds after it crashes. If it crashes 3 times in 10 minutes, it stays stopped until you start it."
                        >
                            <PaperToggle checked={current().restartAfterCrash} disabled={saving()} onChange={(on) => void save({ restartAfterCrash: on })} />
                        </PaperSettingItem>
                        <PaperSettingItem
                            title="Daily restart"
                            description={`Restarts the running server once a day, on this computer's clock (${current().timeZone}). Players are warned 5 minutes and 1 minute before.`}
                        >
                            <PaperSelectMenu
                                name="dailyRestart"
                                value={current().dailyRestart ?? OFF}
                                disabled={saving()}
                                onValueChange={(value) => void save({ dailyRestart: value === OFF ? null : String(value) })}
                            >
                                <PaperSelectMenuItem value={OFF}>Off</PaperSelectMenuItem>
                                <For each={HOURS}>{(hour) => <PaperSelectMenuItem value={hour}>{hourLabel(hour)}</PaperSelectMenuItem>}</For>
                            </PaperSelectMenu>
                        </PaperSettingItem>
                        <Show when={current().canUpdate}>
                            <PaperSettingItem
                                title="Update automatically"
                                description="Installs a new release before the server starts. A running server checks every hour and restarts for one, with 5 minutes' warning when players are on."
                            >
                                <PaperToggle checked={current().autoUpdate} disabled={saving()} onChange={(on) => void save({ autoUpdate: on })} />
                            </PaperSettingItem>
                        </Show>
                    </PaperSettingList>
                )}
            </Show>
        </>
    );
}
