import { createSignal, onMount, For, Show } from "solid-js";
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
} from "@mileniumhq/paperui";
import { serviceApi } from "@mileniumhq/paperapi";
import { PANEL_ID, type BotSummary } from "../bots";
import {
    PERMISSION_DEFINITIONS,
    DEFAULT_SELECTED_PERMISSIONS,
    errorToMessage,
} from "../types";

export default function Invite(props: { bot: () => BotSummary }) {
    const [inviteUrl, setInviteUrl] = createSignal("");
    const [inviteError, setInviteError] = createSignal("");
    const [userInstallUrl, setUserInstallUrl] = createSignal("");
    const [userInstallError, setUserInstallError] = createSignal("");
    const [selectedPermissions, setSelectedPermissions] = createSignal<string[]>(
        DEFAULT_SELECTED_PERMISSIONS,
    );

    // toggles fire requests back to back: only the latest one may land
    let inviteRequest = 0;
    const updateInviteUrl = async (perms: string[]) => {
        const request = ++inviteRequest;
        setInviteError("");
        try {
            const url = await serviceApi.call<string>(
                PANEL_ID,
                "getInviteUrl",
                { bot: props.bot().id, permissions: perms },
            );
            if (!url) throw new Error("getInviteUrl returned no link");
            if (request === inviteRequest) setInviteUrl(url);
        } catch (err) {
            console.error("[Invite] invite URL generation failed:", err);
            if (request !== inviteRequest) return;
            // a link for the old permissions must not be copied as the new one
            setInviteUrl("");
            setInviteError(errorToMessage(err));
        }
    };

    const updateUserInstallUrl = async () => {
        setUserInstallError("");
        try {
            const url = await serviceApi.call<string>(
                PANEL_ID,
                "getUserInstallUrl",
                { bot: props.bot().id },
            );
            if (!url) throw new Error("getUserInstallUrl returned no link");
            setUserInstallUrl(url);
        } catch (err) {
            console.error("[Invite] user install URL generation failed:", err);
            setUserInstallError(errorToMessage(err));
        }
    };

    onMount(() => {
        void updateInviteUrl(selectedPermissions());
        void updateUserInstallUrl();
    });

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
        void updateInviteUrl(updated);
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

            <PaperGrid>
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
                    <Show when={userInstallError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't make the install link">
                            {userInstallError()}
                        </PaperQuote>
                    </Show>
                    <PaperFlex direction="row" gap="full" align="center">
                        <PaperFlex flex minWidth={0}>
                            <PaperText preset="text" truncate>
                                {userInstallUrl() || (userInstallError() ? "No install link" : "Generating user install link…")}
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

export { Invite };
