import { For, Show } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperPageHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
    createRead,
    showError,
} from "@mileniumhq/paperui";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import type { AutomationView } from "../service/automation";
import { useServer } from "../lib/server";

const OFF = "off";
const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const hourLabel = (hour: string) => new Date(2000, 0, 1, Number(hour.slice(0, 2))).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What the server does on its own, for every game: restart after a crash and once a day. */
export default function Automation() {
    const { calls } = useServer();
    const read = createRead(() => calls.readAutomation(), { message: errorMessage, failure: { title: "Couldn't load the automation settings" } });
    const view = read.value;
    // a read again shows the loader, not the last failure
    const loadFailed = () => !read.loading() && read.error() !== null;

    const saves = createSaves({ failed: (err) => showError("Couldn't save the automation settings", errorMessage(err)) });
    // each switch and menu saves its own field; the answer is the whole view
    const field = <K extends "restartAfterCrash" | "dailyRestart" | "autoUpdate">(key: K) =>
        saves.setting<AutomationView[K]>(key, () => view()![key], async (value) => {
            read.set(await calls.writeAutomation({ patch: { [key]: value } }));
        });

    return (
        <>
            <PaperPageHeader icon="schedule" title="Automation" />
            <Show
                when={view()}
                fallback={
                    <Show when={loadFailed()} fallback={<PaperText size={2} color="text-subtle">Loading settings…</PaperText>}>
                        <PaperEmptyState icon="error" title="Couldn't load">
                            <PaperButton disabled={read.loading()} onClick={() => void read.reload()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </Show>
                }
            >
                {(current) => {
                    const restartAfterCrash = field("restartAfterCrash");
                    const dailyRestart = field("dailyRestart");
                    const autoUpdate = field("autoUpdate");
                    return (
                        <PaperSettingList autoHeight>
                            <PaperSettingItem
                                title="Restart after a crash"
                                description="Starts the server again a few seconds after it crashes, or as Paperboard starts if the server stopped while Paperboard was not running. If it crashes 3 times in 10 minutes, it stays stopped until you start it."
                            >
                                <PaperToggle checked={restartAfterCrash.value()} onChange={restartAfterCrash.set} />
                            </PaperSettingItem>
                            <PaperSettingItem
                                title="Daily restart"
                                description={`Restarts the running server once a day, on this computer's clock (${current().timeZone}). Players are warned 5 minutes and 1 minute before.`}
                            >
                                <PaperSelectMenu
                                    name="dailyRestart"
                                    value={dailyRestart.value() ?? OFF}
                                    onValueChange={(value) => dailyRestart.set(value === OFF ? null : String(value))}
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
                                    <PaperToggle checked={autoUpdate.value()} onChange={autoUpdate.set} />
                                </PaperSettingItem>
                            </Show>
                        </PaperSettingList>
                    );
                }}
            </Show>
        </>
    );
}
