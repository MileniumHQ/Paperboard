import {
    createSignal,
    createEffect,
    onMount,
    Show,
    For,
    type JSX,
} from "solid-js";
import {
    PaperFlex,
    PaperPage,
    PaperCard,
    PaperEmptyState,
    PaperText,
    PaperInput,
    PaperButton,
    PaperIcon,
    getVarCss,
} from "@mileniumhq/paperui";
import {
    chatMessages,
    sendChatMessage,
    serverStatus,
    initServerListeners,
} from "../lib/server";
import PlayerHead from "./PlayerHead";

export function PlayerAvatar(props: { name: string }) {
    return (
        <PlayerHead
            name={props.name}
            alt={props.name}
            size="small"
            shape="square"
        />
    );
}

function renderChatMessageContent(text: string): JSX.Element {
    const chatMatch = text.match(/^<([a-zA-Z0-9_]{1,16})>\s*(.*)$/);
    if (chatMatch) {
        return (
            <PaperFlex direction="row" gap="half" align="flex-start">
                <PlayerAvatar name={chatMatch[1]} />
                <PaperText breakWord>
                    <strong>{chatMatch[1]}</strong> {chatMatch[2]}
                </PaperText>
            </PaperFlex>
        );
    }

    const serverMatch = text.match(/^\[Server(?::\s*[^\]]+)?\]\s*(.*)$/);
    if (serverMatch) {
        return (
            <PaperFlex direction="row" gap="half" align="flex-start">
                <span style={{ "word-break": "break-word" }}>
                    <strong>[Server]</strong> {serverMatch[1]}
                </span>
            </PaperFlex>
        );
    }

    const joinMatch = text.match(/^([a-zA-Z0-9_]{1,16})\s+(joined the game)$/i);
    if (joinMatch) {
        return (
            <PaperFlex direction="row" gap="half" align="center">
                <PlayerAvatar name={joinMatch[1]} />
                <span style={{ color: getVarCss("success"), "word-break": "break-word" }}>
                    <strong>{joinMatch[1]}</strong> {joinMatch[2]}
                </span>
            </PaperFlex>
        );
    }

    const leaveMatch = text.match(/^([a-zA-Z0-9_]{1,16})\s+(left the game)$/i);
    if (leaveMatch) {
        return (
            <PaperFlex direction="row" gap="half" align="center">
                <PlayerAvatar name={leaveMatch[1]} />
                <span style={{ color: getVarCss("danger"), "word-break": "break-word" }}>
                    <strong>{leaveMatch[1]}</strong> {leaveMatch[2]}
                </span>
            </PaperFlex>
        );
    }

    return <span>{text}</span>;
}

export default function Chat() {
    let scrollRef: HTMLDivElement | undefined;
    const [inputVal, setInputVal] = createSignal("");

    onMount(() => initServerListeners());

    const scrollToBottom = () => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    };

    createEffect(() => {
        if (chatMessages().length > 0) setTimeout(scrollToBottom, 0);
    });

    const handleSend = (e: Event) => {
        e.preventDefault();
        const text = inputVal().trim();
        if (!text) return;
        sendChatMessage(text);
        setInputVal("");
        setTimeout(scrollToBottom, 0);
    };

    return (
        <PaperPage fullWidth fullHeight gap="full">
            <PaperCard grow minHeight={0}>
                <PaperFlex
                    ref={(el) => (scrollRef = el)}
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
                                <PaperFlex direction="row" gap="half" align="flex-start">
                                    <PaperFlex grow minWidth={0}>
                                        <PaperText size={3} breakWord>
                                            {renderChatMessageContent(msg.text)}
                                        </PaperText>
                                    </PaperFlex>
                                </PaperFlex>
                            )}
                        </For>
                    </Show>
                </PaperFlex>
            </PaperCard>

            <form onSubmit={handleSend} style={{ width: "100%" }}>
                <PaperFlex direction="row" gap="half" align="center" fullWidth>
                    <PaperFlex grow>
                        <PaperInput
                            fullWidth
                            placeholder="Message server..."
                            value={inputVal()}
                            onInput={(e) => setInputVal(e.currentTarget.value)}
                            disabled={serverStatus() === "offline"}
                        />
                    </PaperFlex>
                    <PaperButton disabled={!inputVal().trim() || serverStatus() === "offline"}>
                        <PaperIcon>send</PaperIcon>
                        Say
                    </PaperButton>
                </PaperFlex>
            </form>
        </PaperPage>
    );
}
