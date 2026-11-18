import { createSignal, For, Show, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperCard,
    PaperCheckbox,
    PaperButton,
    PaperCopyButton,
    PaperIcon,
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

    // what a link is for: copy it, or open it; the address itself is not shown
    const linkActions = (url: () => string, what: string): JSX.Element => (
        <PaperFlex direction="row" gap="half" wrap>
            <PaperCopyButton variant="outline" label="Copy link" text={url()} title={`Copy the ${what} link`} disabled={!url()} />
            <PaperButton variant="primary" href={url() || undefined} target="_blank" rel="noopener noreferrer" disabled={!url()}>
                <PaperIcon>open_in_new</PaperIcon>
                Open
            </PaperButton>
        </PaperFlex>
    );

    return (
        <>
            <PaperPageHeader
                icon="person_add"
                title="Invite"
                subtitle="Add the bot to a server, or install it on your account"
            />

            <PaperCard>
                <PaperFlex direction="column" padding="full" gap="full">
                    <PaperFlex direction="column" gap="onefourth">
                        <PaperText preset="heading">Add to a server</PaperText>
                        <PaperText preset="hint">
                            Pick what the bot can do. The link below follows your picks.
                        </PaperText>
                    </PaperFlex>

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

                    {/* the actions stand where the link would be used, or why there is none */}
                    <Show
                        when={invite.error()}
                        fallback={linkActions(inviteUrl, "server invite")}
                    >
                        {(err) => (
                            <PaperError
                                title="Couldn't make the invite link"
                                error={err()}
                                action={{ label: "Try again", disabled: invite.loading(), onClick: () => void invite.reload() }}
                            />
                        )}
                    </Show>
                </PaperFlex>
            </PaperCard>

            <PaperCard>
                <PaperFlex direction="column" padding="full" gap="full">
                    <PaperFlex direction="column" gap="onefourth">
                        <PaperText preset="heading">Install on your account</PaperText>
                        <PaperText preset="hint">
                            Use the bot's commands in DMs and group chats. Turn on User Install in the Discord developer portal first.
                        </PaperText>
                    </PaperFlex>
                    <Show
                        when={userInstall.error()}
                        fallback={linkActions(userInstallUrl, "install")}
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
