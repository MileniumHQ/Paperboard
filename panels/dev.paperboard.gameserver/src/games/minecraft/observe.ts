import { minecraftSoftware } from "./index";
import stripAnsi from "strip-ansi";
import { processApi, type ServiceContext } from "../../service/api";
import { parseChatMessage, parseLogLine } from "../../lib/logs";
import { parseGameruleValue } from "../../core/gamerules";
import { resolveVersionProfile } from "../../lib/versionProfile";
import { trackPlayerActivity, handleStatResponse, handlePositionResponse, queryOnlinePlayers } from "../../service/players";
import { assertSingleLine, isStatQueryReply, extractPosition, extractDimension, isPlayerListResponse } from "../../core/players";
import { checkLogForIssues } from "../../service/diagnostics";
import { onServerOnline } from "../../service/gamerules";
import { applyPendingRuntimeProperties } from "../../service/runtimeProperties";
import { observeSavingLine } from "./saving";
import { type GameServerState, SERVER_PROC_ID, appendCapped } from "../../service/types";
import { TRIGGER_IDS } from "../../service/contract";
export async function sendChatMessage(
    ctx: ServiceContext<GameServerState>,
    msg: string,
): Promise<void> {
    const trimmed = msg.trim();
    if (!trimmed) return;

    if (
        ctx.state.serverStatus === "online" ||
        ctx.state.serverStatus === "starting"
    ) {
        await processApi.write(SERVER_PROC_ID, `say ${trimmed}\n`);
    } else {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        ctx.setState({
            chatMessages: appendCapped(ctx.state.chatMessages, {
                id: `chat-${Date.now()}`,
                text: "Cannot send message: server is offline.",
                timestamp: timeStr,
            }),
        });
        throw new Error("Cannot send message: server is offline.");
    }
}

// gamerule readouts ride the same log stream as every other server line:
// query responses keep the UI honest, write confirmations converge an
// online edit on server truth. Returns whether the line was consumed.
function handleGameruleResponse(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): boolean {
    const profile = resolveVersionProfile(
        minecraftSoftware(ctx.state.serverSoftware),
        ctx.state.serverVersion,
    );
    const parsed = parseGameruleValue(clean, profile);
    if (!parsed) return false;
    ctx.setState((prev) => ({
        gamerules: { ...prev.gamerules, [parsed.name]: parsed.value },
    }));
    return true;
}

export function onReady(ctx: ServiceContext<GameServerState>): void {
    // one `list` so the player cap is known from the start
    queryOnlinePlayers(ctx);
    // boot-time truth: offline gamerule edits re-apply, then
    // every rule is queried so the UI reads live values
    onServerOnline(ctx).catch((err) =>
        console.error("[Service:Lifecycle] gamerule boot sync failed:", err),
    );
    applyPendingRuntimeProperties(ctx).catch((err) =>
        console.error("[Service:Lifecycle] runtime property boot sync failed:", err),
    );
}

export function observeLine(ctx: ServiceContext<GameServerState>, line: string, final = false): void {
    // The old exit path only flushed chat and the last log entry.
    if (final) {
        const chat = parseChatMessage(line);
        if (chat) ctx.setState({ chatMessages: appendCapped(ctx.state.chatMessages, chat) });
        ctx.setState({ serverEntries: appendCapped(ctx.state.serverEntries, parseLogLine(line)) });
        return;
    }
    const clean = stripAnsi(line);
    if (!clean.trim()) return;
    const portMatch = clean.match(/Starting (?:Minecraft )?server on .*:(\d+)/i);
    if (portMatch?.[1] && portMatch[1] !== "0") {
        ctx.setState({ serverPort: portMatch[1] });
    }

    observeSavingLine(clean);
    trackPlayerActivity(ctx, clean);
    const statConsumed = handleStatResponse(ctx, clean);
    const positionConsumed = handlePositionResponse(ctx, clean);
    const gameruleConsumed = handleGameruleResponse(ctx, clean);
    checkLogForIssues(ctx, clean);

    const ready = clean.includes("Done (") || clean.includes("Done in") || clean.includes('For help, type "help"') || clean.includes("Started server");
    if (ready && ctx.state.serverStatus !== "online") {
        ctx.setState({ serverStatus: "online" });
        ctx.emitTrigger(TRIGGER_IDS.serverStarted, true);
        onReady(ctx);
    } else if (!ready && (clean.includes("Stopping server") || clean.includes("Saving players"))) {
        ctx.setState({ serverStatus: "stopping" });
    }

    const chat = parseChatMessage(line);
    if (chat) {
        ctx.setState({
            chatMessages: appendCapped(ctx.state.chatMessages, chat),
        });
        // only player messages emit the chat-message trigger
        if (chat.sender && !chat.event) {
            ctx.emitTrigger(TRIGGER_IDS.chatMessage, chat);
        }
    }

    // Poll responses are consumed into state above; appending them as
    // well floods the console every few seconds (positions every 2s,
    // list every 15s, stats every 30s, gamerule bursts on sync). The
    // entity-data shape is matched directly — not just the pending
    // queues — so a response that arrives after its marker was evicted
    // stays out too. Join/leave lines, chat, errors and real server
    // output still append.
    const pollResponse =
        statConsumed ||
        positionConsumed ||
        gameruleConsumed ||
        isPlayerListResponse(clean) ||
        isStatQueryReply(clean) ||
        extractPosition(clean) !== undefined ||
        extractDimension(clean) !== undefined;

    if (!pollResponse) {
        ctx.setState({
            serverEntries: appendCapped(ctx.state.serverEntries, parseLogLine(line)),
        });
    }
}

export function commandLine(command: string): string {
    assertSingleLine(String(command), "console command", 500);
    const trimmed = command.trim();
    return `${trimmed.startsWith("/") ? trimmed.slice(1) : trimmed}\n`;
}
