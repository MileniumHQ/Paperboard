import { createSignal, onMount, For } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperCard,
    PaperCheckbox,
    PaperCopyButton,
    PaperGrid,
    PaperPageHeader,
    PaperSeparator,
} from "@mileniumhq/paperui";
import { actionsApi } from "@mileniumhq/paperapi";
import {
    PERMISSION_DEFINITIONS,
    DEFAULT_SELECTED_PERMISSIONS,
} from "../types";

export default function Invite() {
    const [inviteUrl, setInviteUrl] = createSignal("");
    const [userInstallUrl, setUserInstallUrl] = createSignal("");
    const [selectedPermissions, setSelectedPermissions] = createSignal<string[]>(
        DEFAULT_SELECTED_PERMISSIONS,
    );

    const updateInviteUrl = async (perms: string[]) => {
        try {
            const url = await actionsApi.call<string>(
                "dev.paperboard.botcreator",
                "get-invite-url",
                perms,
            );
            if (url) {
                setInviteUrl(url);
            }
        } catch (err) {
            console.error("[Invite] invite URL generation failed:", err);
        }
    };

    const updateUserInstallUrl = async () => {
        try {
            const url = await actionsApi.call<string>(
                "dev.paperboard.botcreator",
                "get-user-install-url",
            );
            if (url) {
                setUserInstallUrl(url);
            }
        } catch (err) {
            console.error("[Invite] user install URL generation failed:", err);
        }
    };

    onMount(() => {
        updateInviteUrl(selectedPermissions());
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
        updateInviteUrl(updated);
    };

    const permissionGroup = (
        title: string,
        perms: typeof PERMISSION_DEFINITIONS,
    ) => (
        <PaperCard padding="full" gap="half">
            <PaperText weight={700} size={3}>
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

            <PaperCard>
                <PaperFlex direction="row" padding="full" gap="full" align="center">
                    <PaperText
                        size={3}
                        weight={500}
                        truncate
                        style={{ flex: 1, "min-width": 0 }}
                    >
                        {inviteUrl() || "Generating invite link..."}
                    </PaperText>

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
                    <PaperText weight={700} size={3}>
                        Install on your account
                    </PaperText>
                    <PaperText size={2} color="text-subtle">
                        For user-app commands: installs the app for one user
                        instead of a server, so its commands work in DMs and
                        group chats. Needs User Install enabled in the Discord
                        developer portal.
                    </PaperText>
                    <PaperFlex direction="row" gap="full" align="center">
                        <PaperText
                            size={3}
                            weight={500}
                            truncate
                            style={{ flex: 1, "min-width": 0 }}
                        >
                            {userInstallUrl() || "Generating user install link..."}
                        </PaperText>

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
