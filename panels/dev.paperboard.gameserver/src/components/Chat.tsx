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
    PaperContainer,
    PaperText,
    PaperInput,
    PaperButton,
    PaperIcon,
    getVarCss,
} from "@paperboard-dev/paperui";
import {
    chatMessages,
    sendChatMessage,
    serverStatus,
    initServerListeners,
} from "../lib/server";
import "../style.css";

export function PlayerAvatar(props: { name: string }) {
    return (
        <img
            src={`https://mc-heads.net/avatar/${encodeURIComponent(props.name)}/32`}
            alt={props.name}
            style={{
                width: "1.35em",
                height: "1.35em",
                "image-rendering": "pixelated",
                "flex-shrink": 0,
                "border-radius": "0.15em",
                "margin-top": "0.05em",
            }}
            onError={(e) => {
                e.currentTarget.src = "https://mc-heads.net/avatar/MHF_Steve/32";
            }}
        />
    );
}

function renderChatMessageContent(text: string): JSX.Element {
    const chatMatch = text.match(/^<([a-zA-Z0-9_]{1,16})>\s*(.*)$/);
    if (chatMatch) {
        return (
            <PaperFlex direction="row" gap="half" align="flex-start">
                <PlayerAvatar name={chatMatch[1]} />
                <span style={{ "word-break": "break-word" }}>
                    <strong>{chatMatch[1]}</strong> {chatMatch[2]}
                </span>
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
                <span style={{ color: getVarCss("front-green"), "word-break": "break-word" }}>
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
                <span style={{ color: getVarCss("front-red"), "word-break": "break-word" }}>
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
        <PaperFlex fullHeight fullWidth padding="double" gap="threefourths">
            <PaperFlex fullWidth style={{ flex: 1, "min-height": 0 }}>
                <PaperContainer style={{ flex: 1, height: "100%", "min-height": 0 }}>
                    <div
                        ref={scrollRef}
                        style={{
                            width: "100%",
                            height: "100%",
                            padding: "1em",
                            "overflow-y": "auto",
                            display: "flex",
                            "flex-direction": "column",
                            gap: "0.35em",
                            "box-sizing": "border-box",
                        }}
                    >
                        <Show
                            when={chatMessages().length > 0}
                            fallback={
                                <PaperFlex fullHeight fullWidth align="center" justify="center" style={{ opacity: 0.6 }}>
                                    <PaperText preset="caption">No in-game messages yet.</PaperText>
                                </PaperFlex>
                            }
                        >
                            <For each={chatMessages()}>
                                {(msg) => (
                                    <PaperFlex direction="row" gap="half" align="flex-start" style={{ "line-height": 1.4 }}>
                                        <PaperText size={3} style={{ flex: 1, "word-break": "break-word" }}>
                                            {renderChatMessageContent(msg.text)}
                                        </PaperText>
                                    </PaperFlex>
                                )}
                            </For>
                        </Show>
                    </div>
                </PaperContainer>
            </PaperFlex>

            <form
                onSubmit={handleSend}
                style={{
                    width: "100%",
                    "flex-shrink": 0,
                    display: "flex",
                    gap: "0.5em",
                    "align-items": "center",
                }}
            >
                <PaperInput
                    fullWidth
                    placeholder="Message server..."
                    value={inputVal()}
                    onInput={(e) => setInputVal(e.currentTarget.value)}
                    disabled={serverStatus() === "offline"}
                />
                <PaperButton compact disabled={!inputVal().trim() || serverStatus() === "offline"}>
                    <PaperIcon>send</PaperIcon>
                    Say
                </PaperButton>
            </form>
        </PaperFlex>
    );
}
