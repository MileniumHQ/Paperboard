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
} from "paperui";
import {
    chatMessages,
    sendChatMessage,
    serverStatus,
    initServerListeners,
} from "./server";
import "./style.css";

const skinUrlCache = new Map<string, string>();
const skinPromiseCache = new Map<string, Promise<string | null>>();

const DEFAULT_STEVE_SKIN =
    "https://textures.minecraft.net/texture/1a429dd934449830588661eb175069a5840d210967ab4cb8798e1694f481c967";

export async function fetchMojangSkinUrl(
    username: string,
): Promise<string | null> {
    if (skinUrlCache.has(username)) {
        return skinUrlCache.get(username)!;
    }
    if (skinPromiseCache.has(username)) {
        return skinPromiseCache.get(username)!;
    }

    const promise = (async () => {
        try {
            const res = await fetch(
                `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
            );
            if (!res.ok) return null;
            const profile = await res.json();
            if (!profile?.id) return null;

            const sessionRes = await fetch(
                `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`,
            );
            if (!sessionRes.ok) return null;
            const sessionData = await sessionRes.json();
            const prop = sessionData.properties?.find(
                (p: any) => p.name === "textures",
            );
            if (!prop?.value) return null;

            const decoded = JSON.parse(atob(prop.value));
            const skinUrl = decoded?.textures?.SKIN?.url || null;
            if (skinUrl) {
                const secureUrl = skinUrl.replace(/^http:\/\//i, "https://");
                skinUrlCache.set(username, secureUrl);
                return secureUrl;
            }
            return null;
        } catch (err) {
            console.error(
                `[Mojang API] Could not fetch skin for ${username}:`,
                err,
            );
            return null;
        }
    })();

    skinPromiseCache.set(username, promise);
    return promise;
}

export function PlayerAvatar(props: { name: string }) {
    let canvasRef: HTMLCanvasElement | undefined;

    const drawSkin = (img: HTMLImageElement) => {
        if (!canvasRef) return;
        const ctx = canvasRef.getContext("2d");
        if (!ctx) return;

        const w = 32;
        const h = 32;
        canvasRef.width = w;
        canvasRef.height = h;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, w, h);

        const innerSize = 27;
        const offset = Math.round((w - innerSize) / 2);
        ctx.drawImage(img, 8, 8, 8, 8, offset, offset, innerSize, innerSize);

        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, w, h);
    };

    const loadAndDraw = async () => {
        const url = await fetchMojangSkinUrl(props.name);
        const img = new Image();
        img.onload = () => drawSkin(img);
        img.onerror = () => {
            const fallback = new Image();
            fallback.onload = () => drawSkin(fallback);
            fallback.src = DEFAULT_STEVE_SKIN;
        };
        img.src = url || DEFAULT_STEVE_SKIN;
    };

    onMount(() => {
        loadAndDraw();
    });

    createEffect(() => {
        props.name;
        loadAndDraw();
    });

    return (
        <canvas
            ref={canvasRef}
            width={32}
            height={32}
            style={{
                width: "1.35em",
                height: "1.35em",
                "image-rendering": "pixelated",
                "flex-shrink": 0,
                "border-radius": "0.15em",
                "margin-top": "0.05em",
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
                <span
                    style={{
                        color: "var(--paper-front-green)",
                        "word-break": "break-word",
                    }}
                >
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
                <span
                    style={{
                        color: "var(--paper-front-red)",
                        "word-break": "break-word",
                    }}
                >
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

    onMount(() => {
        initServerListeners();
    });

    const scrollToBottom = () => {
        if (scrollRef) {
            scrollRef.scrollTop = scrollRef.scrollHeight;
        }
    };

    createEffect(() => {
        if (chatMessages().length > 0) {
            setTimeout(scrollToBottom, 0);
        }
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
                <PaperContainer
                    style={{ flex: 1, height: "100%", "min-height": 0 }}
                >
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
                                <PaperFlex
                                    fullHeight
                                    fullWidth
                                    align="center"
                                    justify="center"
                                    style={{ opacity: 0.6 }}
                                >
                                    <PaperText preset="caption">
                                        No in-game messages yet.
                                    </PaperText>
                                </PaperFlex>
                            }
                        >
                            <For each={chatMessages()}>
                                {(msg) => (
                                    <PaperFlex
                                        direction="row"
                                        gap="half"
                                        align="flex-start"
                                        style={{ "line-height": 1.4 }}
                                    >
                                        <PaperText
                                            size={3}
                                            style={{
                                                flex: 1,
                                                "word-break": "break-word",
                                            }}
                                        >
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
                <PaperButton
                    compact
                    disabled={
                        !inputVal().trim() || serverStatus() === "offline"
                    }
                >
                    <PaperIcon>send</PaperIcon>
                    Say
                </PaperButton>
            </form>
        </PaperFlex>
    );
}
