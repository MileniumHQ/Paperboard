import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperIcon, PaperInput, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { gameSettings, sendChatMessage } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { palworld } from "./index";

export default function PalworldOverview() {
    const [open, setOpen] = createSignal(false);
    const [message, setMessage] = createSignal("");
    const [sending, setSending] = createSignal(false);
    const [error, setError] = createSignal("");
    const close = () => { setOpen(false); setError(""); };
    const announce = async () => {
        setSending(true);
        setError("");
        try {
            await sendChatMessage(message().trim());
            setMessage("");
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSending(false);
        }
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={palworld.art.icon} alt="Palworld" fallbackIcon="pets" />}
            detail={<PaperText color="text-subtle">{String(gameSettings().ServerName ?? "")}</PaperText>}
            software="Steam"
            commands={palworld.describe({ software: "", version: "" }).control.kind !== "none"}
            actions={
                <PaperButton onClick={() => setOpen(true)}>
                    <PaperIcon>campaign</PaperIcon>
                    Announce
                </PaperButton>
            }
        >
            <PaperModal
                open={open()}
                onClose={close}
                title="Announce"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={close}>Cancel</PaperButton>
                        <PaperButton variant="primary" disabled={sending() || !message().trim()} onClick={() => void announce()}>
                            {sending() ? "Sending..." : "Announce"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">Everyone on the server sees this message.</PaperText>
                <PaperInput
                    label="Message"
                    fullWidth
                    value={message()}
                    maxLength={200}
                    onInput={(e) => setMessage(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && message().trim() && !sending()) void announce(); }}
                />
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Message not sent">{error()}</PaperQuote>
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
