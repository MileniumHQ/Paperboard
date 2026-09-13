import { createSignal, onMount, For } from "solid-js";
import {
    PaperFlex,
    PaperContainer,
    PaperText,
    PaperButton,
    PaperCheckbox,
    PaperIcon,
    PaperSeparator,
} from "@paperboard-dev/paperui";
import { actionsApi } from "@paperboard-dev/paperapi";
import {
    PERMISSION_DEFINITIONS,
    DEFAULT_SELECTED_PERMISSIONS,
} from "../types";

export default function Invite() {
    const [copied, setCopied] = createSignal(false);
    const [inviteUrl, setInviteUrl] = createSignal("");
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
        } catch (err) { console.error('[Invite] invite URL generation failed:', err); }
    };

    onMount(() => {
        updateInviteUrl(selectedPermissions());
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

    const handleCopyInvite = async () => {
        const url = inviteUrl();
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            // a failed copy must not falsely claim "Copied"
            console.error("[Invite] clipboard copy failed:", err);
        }
    };

    const generalPerms = () =>
        PERMISSION_DEFINITIONS.filter((p) => p.category === "general");
    const textPerms = () =>
        PERMISSION_DEFINITIONS.filter((p) => p.category === "text");
    const voicePerms = () =>
        PERMISSION_DEFINITIONS.filter((p) => p.category === "voice");

    return (
        <PaperFlex
            fullHeight
            fullWidth
            padding="double"
            gap="threefourths"
            style={{ "box-sizing": "border-box" }}
        >
            <PaperContainer style={{ "flex-shrink": 0 }}>
                <PaperFlex
                    direction="row"
                    justify="space-between"
                    align="center"
                    padding="full"
                    gap="full"
                >
                    <PaperText
                        size={3}
                        weight={500}
                        style={{
                            flex: 1,
                            "min-width": 0,
                            // long invite URLs must stay readable: wrap
                            // instead of ellipsizing behind one line
                            "overflow-wrap": "anywhere",
                            "white-space": "normal",
                        }}
                    >
                        {inviteUrl() || "Generating invite link..."}
                    </PaperText>

                    <PaperButton
                        variant="brand"
                        compact
                        onClick={handleCopyInvite}
                        disabled={!inviteUrl()}
                    >
                        <PaperIcon>
                            {copied() ? "check" : "content_copy"}
                        </PaperIcon>
                        {copied() ? "Copied" : "Copy"}
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>

            <div
                style={{
                    display: "grid",
                    "grid-template-columns": "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "var(--paper-uigap)",
                    width: "100%",
                    "box-sizing": "border-box",
                }}
            >
                <PaperContainer>
                    <PaperFlex padding="full" gap="half">
                        <PaperText weight={700} size={3}>
                            General
                        </PaperText>
                        <PaperSeparator />
                        <For each={generalPerms()}>
                            {(perm) => (
                                <PaperCheckbox
                                    checked={isSelected(perm.id)}
                                    label={perm.name}
                                    onChange={(checked) =>
                                        handleToggle(perm.id, checked)
                                    }
                                />
                            )}
                        </For>
                    </PaperFlex>
                </PaperContainer>

                <PaperContainer>
                    <PaperFlex padding="full" gap="half">
                        <PaperText weight={700} size={3}>
                            Text
                        </PaperText>
                        <PaperSeparator />
                        <For each={textPerms()}>
                            {(perm) => (
                                <PaperCheckbox
                                    checked={isSelected(perm.id)}
                                    label={perm.name}
                                    onChange={(checked) =>
                                        handleToggle(perm.id, checked)
                                    }
                                />
                            )}
                        </For>
                    </PaperFlex>
                </PaperContainer>

                <PaperContainer>
                    <PaperFlex padding="full" gap="half">
                        <PaperText weight={700} size={3}>
                            Voice
                        </PaperText>
                        <PaperSeparator />
                        <For each={voicePerms()}>
                            {(perm) => (
                                <PaperCheckbox
                                    checked={isSelected(perm.id)}
                                    label={perm.name}
                                    onChange={(checked) =>
                                        handleToggle(perm.id, checked)
                                    }
                                />
                            )}
                        </For>
                    </PaperFlex>
                </PaperContainer>
            </div>
        </PaperFlex>
    );
}

export { Invite };
