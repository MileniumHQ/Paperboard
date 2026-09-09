import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperContainer,
    PaperText,
    PaperQuote,
    PaperCenteredInterface,
} from "@paperboard-dev/paperui";
import { actionsApi, config } from "@paperboard-dev/paperapi";
import { DEFAULT_DISCORD_AVATAR } from "../types";

export default function Overview() {
    const [name, setName] = createSignal("Discord Bot");
    const [tag, setTag] = createSignal("");
    const [avatar, setAvatar] = createSignal(DEFAULT_DISCORD_AVATAR);
    const [appId, setAppId] = createSignal("");
    const [servers, setServers] = createSignal(0);

    const loadBotInfo = async () => {
        try {
            const saved = await config.get<any>();
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch {}

        try {
            const info = await actionsApi.call<any>(
                "dev.paperboard.botcreator",
                "get-bot-info",
            );
            if (info) {
                if (info.name) setName(info.name);
                if (info.tag) setTag(info.tag);
                if (info.avatar) setAvatar(info.avatar);
                if (info.applicationId) setAppId(info.applicationId);
                if (typeof info.guildCount === "number") setServers(info.guildCount);
            }
        } catch {}
    };

    onMount(() => {
        loadBotInfo();
    });

    return (
        <PaperCenteredInterface size="large">
            <PaperFlex fullWidth gap="full">
                <PaperContainer>
                    <PaperFlex fullWidth padding="double" gap="full" align="center" direction="row">
                        <img
                            src={avatar() || DEFAULT_DISCORD_AVATAR}
                            alt={name()}
                            style={{
                                width: "72px",
                                height: "72px",
                                "border-radius": "50%",
                                "object-fit": "cover",
                                border: "1px solid var(--paper-border)",
                            }}
                        />

                        <PaperFlex direction="column" gap="onefourth" style={{ flex: 1, "min-width": 0 }}>
                            <PaperFlex direction="row" gap="half" align="baseline">
                                <PaperText weight={700} size={7}>
                                    {name()}
                                </PaperText>
                                <Show when={tag() && tag() !== name()}>
                                    <PaperText size={3} color="light-text">
                                        @{tag()}
                                    </PaperText>
                                </Show>
                            </PaperFlex>

                            <PaperFlex direction="row" gap="full" align="center" style={{ "margin-top": "0.25rem" }}>
                                <Show when={appId()}>
                                    <PaperText size={2} color="light-text">
                                        Application ID: {appId()}
                                    </PaperText>
                                </Show>
                                <PaperText size={2} color="light-text">
                                    {servers()} {servers() === 1 ? "server" : "servers"}
                                </PaperText>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperFlex>
                </PaperContainer>

                <PaperQuote variant="brand" icon="extension" title="Note">
                    Install Actions from the Panel Library to do more with the bot.
                </PaperQuote>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

export { Overview };
