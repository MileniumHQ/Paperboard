import { createSignal } from "solid-js";
import {
    PaperText,
    PaperButton,
    PaperPageHeader,
    PaperSettingList,
    PaperSettingItem,
} from "@mileniumhq/paperui";
import { DeleteBotModal, ReplaceTokenModal } from "./BotDialogs";
import type { BotSummary } from "../bots";

export interface ConfigurationProps {
    bot: () => BotSummary;
    onReplaceToken: (id: string, token: string) => Promise<unknown>;
    onDelete: (id: string) => Promise<unknown>;
}

export default function Configuration(props: ConfigurationProps) {
    const [replacing, setReplacing] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);

    return (
        <>
            <PaperPageHeader
                icon="settings"
                title="Configuration"
                subtitle="Credentials and removal"
            />

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Application ID"
                    description="The Discord Snowflake ID for this bot"
                >
                    <PaperText size={3} color="text-subtle">
                        {props.bot().applicationId || "Unknown"}
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Bot Token"
                    description={props.bot().hasToken
                        ? "Kept in Paperboard's secret store. Replace it after resetting it in the Developer Portal"
                        : "No token is saved, so the bot can't connect"}
                >
                    <PaperButton onClick={() => setReplacing(true)}>Replace</PaperButton>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Delete Bot"
                    description="Take the bot offline and delete its token and slash commands"
                >
                    <PaperButton variant="danger" onClick={() => setDeleting(true)}>
                        Delete
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <ReplaceTokenModal bot={replacing() ? props.bot() : null} onReplace={props.onReplaceToken} onClose={() => setReplacing(false)} />
            <DeleteBotModal bot={deleting() ? props.bot() : null} onDelete={props.onDelete} onClose={() => setDeleting(false)} />
        </>
    );
}
