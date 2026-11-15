import { createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperCard,
    PaperCheckbox,
    PaperCopyButton,
    PaperGrid,
    PaperPageHeader,
    PaperQuote,
    PaperSeparator,
    usePaperPanel,
    createRead,
} from "@mileniumhq/paperui";
import type { BotSummary } from "../bots";
import { botCreator } from "../client";
import { PERMISSION_DEFINITIONS, DEFAULT_SELECTED_PERMISSIONS } from "../permissions";

export default function Invite(props: { bot: () => BotSummary }) {
    // the phone layout of the panel this page is in
    const panel = usePaperPanel();
    const compact = () => Boolean(panel?.compact?.());
    const [selectedPermissions, setSelectedPermissions] = createSignal<string[]>(
        DEFAULT_SELECTED_PERMISSIONS,
    );

    // read again for each change of the permissions; only the newest lands
    const invite = createRead((permissions) => botCreator.calls.getInviteUrl({ bot: props.bot().id, permissions }), {
        source: selectedPermissions,
    });
    // a read again hides the last one's failure, as it did before it was asked
    const inviteError = () => (invite.loading() ? null : invite.error());
    // a link for the old permissions must not be copied as the new one
    const inviteUrl = () => (invite.error() ? "" : invite.value() ?? "");
    const userInstall = createRead(() => botCreator.calls.getUserInstallUrl({ bot: props.bot().id }));
    const userInstallUrl = () => userInstall.value() ?? "";

    const isSelected = (permId: string) =>
        selectedPermissions().includes(permId);

    const handleToggle = (permId: string, checked: boolean) => {
        const current = selectedPermissions();
        let updated: string[];
        if (checked) {
            updated = current.includes(permId) ? current : [...current, permId];
        } else {
            updated = current.filter((p) => p !== permId);
        }
        setSelectedPermissions(updated);
    };

    const permissionGroup = (
        title: string,
        perms: typeof PERMISSION_DEFINITIONS,
    ) => (
        <PaperCard padding="full" gap="half">
            <PaperText preset="label">
                {title}
            </PaperText>
            <PaperSeparator />
            <For each={perms}>
                {(perm) => (
                    <PaperCheckbox
                        checked={isSelected(perm.id)}
                        label={perm.name}
                        onChange={(checked) => handleToggle(perm.id, checked)}
                    />
                )}
            </For>
        </PaperCard>
    );

    return (
        <>
            <PaperPageHeader
                icon="person_add"
                title="Invite"
                subtitle="Add the bot to a server with the permissions it needs"
            />

            <Show when={inviteError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't make the invite link">
                    {inviteError()}
                </PaperQuote>
            </Show>

            <PaperCard>
                <PaperFlex direction="row" padding="full" gap="full" align="center">
                    <PaperFlex flex minWidth={0}>
                        <PaperText preset="text" truncate>
                            {inviteUrl() || (inviteError() ? "No invite link" : "Generating invite link…")}
                        </PaperText>
                    </PaperFlex>

                    <PaperCopyButton
                        label="Copy"
                        text={inviteUrl()}
                        disabled={!inviteUrl()}
                    />
                </PaperFlex>
            </PaperCard>

            {/* three groups fill the row; an auto-filling grid would leave a column empty */}
            <PaperGrid columns={compact() ? 1 : 3}>
                {permissionGroup(
                    "General",
                    PERMISSION_DEFINITIONS.filter((p) => p.category === "general"),
                )}
                {permissionGroup(
                    "Text",
                    PERMISSION_DEFINITIONS.filter((p) => p.category === "text"),
                )}
                {permissionGroup(
                    "Voice",
                    PERMISSION_DEFINITIONS.filter((p) => p.category === "voice"),
                )}
            </PaperGrid>

            <PaperCard>
                <PaperFlex direction="column" padding="full" gap="half">
                    <PaperText preset="label">
                        Install on your account
                    </PaperText>
                    <PaperText preset="hint">
                        For user-app commands: installs the app for one user
                        instead of a server, so its commands work in DMs and
                        group chats. Needs User Install enabled in the Discord
                        developer portal.
                    </PaperText>
                    <Show when={userInstall.error()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't make the install link">
                            {userInstall.error()}
                        </PaperQuote>
                    </Show>
                    <PaperFlex direction="row" gap="full" align="center">
                        <PaperFlex flex minWidth={0}>
                            <PaperText preset="text" truncate>
                                {userInstallUrl() || (userInstall.error() ? "No install link" : "Generating user install link…")}
                            </PaperText>
                        </PaperFlex>

                        <PaperCopyButton
                            label="Copy"
                            text={userInstallUrl()}
                            disabled={!userInstallUrl()}
                        />
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
        </>
    );
}
