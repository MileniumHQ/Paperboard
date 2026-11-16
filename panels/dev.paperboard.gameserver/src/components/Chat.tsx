import { createSignal, createEffect, onMount, Show, For, type JSX, on } from "solid-js";
import {
    PaperFlex,
    PaperCard,
    PaperEmptyState,
    PaperText,
    PaperInput,
    PaperButton,
    PaperIcon,
    PaperPageHeader,
    PaperQuote,
} from "@mileniumhq/paperui";
import { errorMessage } from "../lib/failure";
import { useServer, type ChatMessage } from "../lib/server";

function MessageContent(props: { message: ChatMessage; avatar: (name: string) => JSX.Element }) {
    const m = props.message;
    if (m.event === "server") {
        return <PaperText size={3} breakWord><strong>[Server]</strong> {m.content}</PaperText>;
    }
    if (m.sender && (m.event === "join" || m.event === "leave")) {
        return (
            <PaperFlex direction="row" gap="half" align="center">
                {props.avatar(m.sender)}
                <PaperText size={3} color={m.event === "join" ? "success" : "danger"} breakWord>
                    <strong>{m.sender}</strong> {m.event === "join" ? "joined the game" : "left the game"}
                </PaperText>
            </PaperFlex>
        );
    }
    if (m.sender) {
        return (
            <PaperFlex direction="row" gap="half" align="flex-start">
                {props.avatar(m.sender)}
                <PaperText size={3} breakWord><strong>{m.sender}</strong> {m.content}</PaperText>
            </PaperFlex>
        );
    }
    return <PaperText size={3} breakWord>{m.text}</PaperText>;
}

/** how near its end, in pixels, the chat still counts as read at its end */
const END_SLACK_PX = 24;

/** The game's in-game chat. Each game draws its own small player avatar. */
export default function Chat(props: { avatar: (name: string) => JSX.Element }) {
    const { calls, chatMessages, loadServerConfig, serverStatus } = useServer();
    let scrollRef: HTMLDivElement | undefined;
    const [inputVal, setInputVal] = createSignal("");
    const [sendError, setSendError] = createSignal("");

    onMount(() => void loadServerConfig());

    // the chat follows new messages only while it's read at its end; someone
    // scrolled up to read stays where they are
    let atEnd = true;
    const onScroll = () => {
        if (scrollRef) atEnd = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < END_SLACK_PX;
    };
    const scrollToBottom = () => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    };

    createEffect(
        on(
            () => chatMessages().length,
            (count) => {
                if (count > 0 && atEnd) setTimeout(scrollToBottom, 0);
            },
        ),
    );

    const handleSend = (e: Event) => {
        e.preventDefault();
        const text = inputVal().trim();
        if (!text) return;
        setSendError("");
        setInputVal("");
        // what you send is what you want to see
        atEnd = true;
        // a message that did not go out comes back to the field, with why,
        // unless a newer one is being typed there
        calls.sayChat({ message: text }).catch((err) => {
            if (!inputVal()) setInputVal(text);
            setSendError(errorMessage(err));
        });
        setTimeout(scrollToBottom, 0);
    };

    return (
        <>
            <PaperPageHeader icon="chat" title="Chat" />
            <PaperCard grow minHeight={0}>
                <PaperFlex
                    ref={(el) => (scrollRef = el)}
                    onScroll={onScroll}
                    direction="column"
                    fullWidth
                    grow
                    minHeight={0}
                    scrollable="y"
                    padding="full"
                    gap="onefourth"
                >
                    <Show
                        when={chatMessages().length > 0}
                        fallback={
                            <PaperEmptyState
                                icon="chat"
                                title="No in-game messages yet."
                            />
                        }
                    >
                        <For each={chatMessages()}>
                            {(msg) => (
                                <PaperFlex minWidth={0} data-selectable="true">
                                    <MessageContent message={msg} avatar={props.avatar} />
                                </PaperFlex>
                            )}
                        </For>
                    </Show>
                </PaperFlex>
            </PaperCard>

            <Show when={sendError()}>
                <PaperQuote variant="danger" icon="warning" title="Message not sent" onDismiss={() => setSendError("")}>
                    {sendError()}
                </PaperQuote>
            </Show>

            <form onSubmit={handleSend}>
                <PaperFlex direction="row" gap="half" align="center" fullWidth>
                    <PaperFlex grow>
                        <PaperInput
                            fullWidth
                            placeholder="Message"
                            value={inputVal()}
                            onInput={(e) => setInputVal(e.currentTarget.value)}
                            disabled={serverStatus() === "offline"}
                        />
                    </PaperFlex>
                    <PaperButton type="submit" disabled={!inputVal().trim() || serverStatus() === "offline"}>
                        <PaperIcon>send</PaperIcon>
                        Say
                    </PaperButton>
                </PaperFlex>
            </form>
        </>
    );
}
