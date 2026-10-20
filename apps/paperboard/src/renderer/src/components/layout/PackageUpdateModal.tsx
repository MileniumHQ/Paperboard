import { For, Show } from "solid-js";
import { PaperModal, PaperFlex, PaperText, PaperButton } from "@mileniumhq/paperui";
import type { PackageUpdateNotice, PackageUpdatesState } from "../../../../shared/packageUpdates";

function listOf(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function noticeText(notice: PackageUpdateNotice, showComputer: boolean): string {
    const where = showComputer ? `On ${notice.computerName}: ` : "";
    if (notice.error) {
        return `${where}The ${notice.packageName} ${notice.version} update could not be installed, so the current version stays in use. Paperboard tries again on its next update check.`;
    }
    // processes the app started itself belong to no panel
    if (notice.panels.length === 0 || (notice.panels.length === 1 && notice.panels[0] === "Paperboard")) {
        return `${where}The package ${notice.packageName} needs an update, but processes Paperboard started are using it. Stop them, and it will update automatically.`;
    }
    const panels = listOf(notice.panels);
    return `${where}The package ${notice.packageName} needs an update, but ${panels} ${notice.panels.length === 1 ? "is" : "are"} using it. Stop the processes in ${notice.panels.length === 1 ? "this panel" : "these panels"}, and they will update automatically.`;
}

export default function PackageUpdateModal(props: {
    state: PackageUpdatesState;
    error: string | null;
    open: boolean;
    onClose(): void;
    onRefresh(): void;
}) {
    const showComputer = () => new Set(props.state.notices.map((n) => n.computerId)).size > 1 || props.state.notices.some((n) => n.computerId !== "local");
    return <PaperModal
        open={props.open}
        onClose={props.onClose}
        title="Package updates waiting"
        size="medium"
        footer={<PaperFlex direction="row" gap="full" justify="flex-end">
            <PaperButton variant="text" onClick={props.onRefresh}>Check again</PaperButton>
            <PaperButton onClick={props.onClose}>Close</PaperButton>
        </PaperFlex>}
    >
        <PaperFlex direction="column" gap="full">
            <Show when={props.state.notices.length === 0 && !props.error}>
                <PaperText>Every package is up to date.</PaperText>
            </Show>
            <For each={props.state.notices}>
                {(notice) => <PaperFlex direction="column" gap="half">
                    <PaperText>{noticeText(notice, showComputer())}</PaperText>
                    <Show when={notice.error}>
                        <PaperText color="danger" style={{ "overflow-wrap": "anywhere" }}>{notice.error}</PaperText>
                    </Show>
                </PaperFlex>}
            </For>
            <For each={props.state.failures}>
                {(failure) => <PaperText color="danger" style={{ "overflow-wrap": "anywhere" }}>Could not check {failure.computerName}: {failure.error}</PaperText>}
            </For>
            <Show when={props.error}><PaperText role="alert" color="danger">{props.error}</PaperText></Show>
        </PaperFlex>
    </PaperModal>;
}
