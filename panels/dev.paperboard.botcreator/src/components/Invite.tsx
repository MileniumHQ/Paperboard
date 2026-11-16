import { createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperCard,
    PaperCheckbox,
    PaperCopyButton,
    PaperError,
    PaperGrid,
    PaperPageHeader,
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

            {/* the link stands where it would be copied from, or why there is none */}
            <Show
                when={invite.error()}
                fallback={
                    <PaperCard>
                        <PaperFlex direction="row" padding="full" gap="full" align="center">
                            <PaperFlex flex minWidth={0}>
                                <PaperText preset="text" truncate>
                                    {inviteUrl() || "Generating invite link…"}
                                </PaperText>
                            </PaperFlex>

                            <PaperCopyButton
                                label="Copy"
                                text={inviteUrl()}
                                disabled={!inviteUrl()}
                            />
                        </PaperFlex>
                    </PaperCard>
                }
            >
                {(err) => (
                    <PaperError
                        title="Couldn't make the invite link"
                        error={err()}
                        action={{ label: "Try again", disabled: invite.loading(), onClick: () => void invite.reload() }}
                    />
                )}
            </Show>

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
                    <Show
                        when={userInstall.error()}
                        fallback={
                            <PaperFlex direction="row" gap="full" align="center">
                                <PaperFlex flex minWidth={0}>
                                    <PaperText preset="text" truncate>
                                        {userInstallUrl() || "Generating user install link…"}
                                    </PaperText>
                                </PaperFlex>

                                <PaperCopyButton
                                    label="Copy"
                                    text={userInstallUrl()}
                                    disabled={!userInstallUrl()}
                                />
                            </PaperFlex>
                        }
                    >
                        {(err) => (
                            <PaperError
                                title="Couldn't make the install link"
                                error={err()}
                                action={{ label: "Try again", disabled: userInstall.loading(), onClick: () => void userInstall.reload() }}
                            />
                        )}
                    </Show>
                </PaperFlex>
            </PaperCard>
        </>
    );
}
