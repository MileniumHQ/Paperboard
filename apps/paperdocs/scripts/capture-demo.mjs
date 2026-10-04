import { captureBrowser } from "./capture-browser.mjs";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Screenshot-only demo producers. Never import this module into the app.
// A temporary daemon must already be running in browser mode; check its actual
// socket port against that install's handshake before allowing captures.
if (!process.env.PAPERBOARD_DIR)
    throw new Error("Set PAPERBOARD_DIR to the temporary browser-mode install.");
const fixtureDir = realpathSync(process.env.PAPERBOARD_DIR);
if (!fixtureDir.startsWith(realpathSync(tmpdir()) + sep))
    throw new Error("Screenshot capture requires a temporary PAPERBOARD_DIR.");
const expectedPort = JSON.parse(readFileSync(join(fixtureDir, "local/crane.json"), "utf8")).port;
const origin = process.env.PAPERBOARD_BROWSER_ORIGIN || "http://paperboard.localhost:4319";
const root = fileURLToPath(new URL("../public/screens/", import.meta.url));
const icon = (text, color) =>
    "data:image/svg+xml," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="28" fill="${color}"/><text x="64" y="85" text-anchor="middle" fill="white" font-family="sans-serif" font-size="60" font-weight="800">${text}</text></svg>`,
    );
const users = ["Notch", "jeb_", "Dinnerbone", "Grumm", "Searge"];
const guilds = [
    ["124800000000000001", "Game Night", 42, "GN", "#eb4169"],
    ["124800000000000002", "The Workshop", 128, "W", "#237be0"],
    ["124800000000000003", "Paperboard Community", 256, "P", "#7757d9"],
].map(([id, name, memberCount, label, color]) => ({
    id,
    name,
    memberCount,
    channelCount: 12,
    roleCount: 6,
    ownerId: "124800000000000099",
    icon: icon(label, color),
}));
const health = {
    connected: true,
    lastError: null,
    uptimeMs: 112320000,
    wsPing: 28,
    guildCount: 3,
    cachedUsers: 426,
    cachedChannels: 36,
    memoryRss: 84 * 1024 * 1024,
    memoryHeapUsed: 26 * 1024 * 1024,
    commandsReceived: 1248,
    pendingInteractions: 0,
    commandSyncError: null,
};
const commands = [
    ["welcome", "Say hello to a new community member"],
    ["server", "Check the Minecraft server status"],
    ["poll", "Start a vote for our next game night"],
    ["help", "Find commands and community links"],
].map(([name, description], i) => ({
    id: "demo-command-" + i,
    name,
    description,
    scope: "global",
    userInstall: false,
    options: [],
}));
const game = {
    serverStatus: "online",
    localIp: "192.168.1.42",
    serverPort: "25565",
    serverMotd: "Game Night ,  build something together",
    serverSoftware: "paper",
    serverVersion: "1.21.11",
    ramAllocation: 4,
    onlinePlayers: users.map((n) => n.toLowerCase()),
    seenPlayers: [...users, "C418", "xisumavoid"].map((n) => n.toLowerCase()),
    playerStats: Object.fromEntries(
        users.map((n, i) => [
            n.toLowerCase(),
            { health: 20 - i * 2, food: 20 - i, xpLevel: 32 + i * 7, xpProgress: 0.42 },
        ]),
    ),
    playerPlaytime: Object.fromEntries(users.map((n, i) => [n.toLowerCase(), 7200 + i * 5800])),
    playerPositions: {},
    gamerules: {
        keepInventory: "true",
        doDaylightCycle: "true",
        doMobSpawning: "true",
        mobGriefing: "false",
    },
    activeIssue: null,
    installProgress: null,
    serverEntries: [
        ["info", "[18:42:01 INFO]: Starting Minecraft server version 1.21.11"],
        ["info", "[18:42:01 INFO]: Loading properties"],
        ["info", "[18:42:02 INFO]: This server is running Paper 1.21.11"],
        ["info", "[18:42:02 INFO]: Default game type: SURVIVAL"],
        ["info", "[18:42:02 INFO]: Starting Minecraft server on *:25565"],
        ["info", "[18:42:03 INFO]: [LuckPerms] Loading LuckPerms v5.4.153"],
        ["info", "[18:42:03 INFO]: [spark] Loading spark v1.10.173"],
        ["info", "[18:42:03 INFO]: [BlueMap] Loading BlueMap v5.7"],
        ["info", '[18:42:04 INFO]: Preparing level "world"'],
        ["info", "[18:42:05 INFO]: Preparing start region for dimension minecraft:overworld"],
        ["info", "[18:42:06 INFO]: Preparing spawn area: 100%"],
        ["info", '[18:42:06 INFO]: Done (4.284s)! For help, type "help"'],
        ...users.map((n, i) => ["info", `[18:4${3 + i}:12 INFO]: ${n} joined the game`]),
        ["output", "[18:49:21 INFO]: <MapleLeaf> The new town square looks amazing!"],
        ["output", "[18:49:35 INFO]: <NovaBuilder> Meet by the fountain for game night?"],
        ["output", "[18:49:40 INFO]: <PixelPanda> On my way! Bringing snacks."],
    ].map(([type, content], i) => ({ id: i, type, content })),
    chatMessages: [],
};
// This baseline comes from a server actually started through the panel.
const realGame = JSON.parse(readFileSync(join(fixtureDir, "real-server-state.json"), "utf8"));
if (realGame.serverStatus !== "online")
    throw new Error("Capture a real online Minecraft server first.");
Object.assign(game, {
    serverStatus: realGame.serverStatus,
    serverSoftware: realGame.serverSoftware,
    serverVersion: realGame.serverVersion,
    gamerules: realGame.gamerules,
    serverEntries: realGame.serverEntries.filter(
        (entry) => !entry.content.includes("WARN") && !entry.content.includes("ERROR"),
    ),
});
const now = Date.now();
const model = "qwen3:8b";
let chat = {
    id: "demo-game-night",
    title: "A little inspiration for game night",
    model,
    createdAt: now - 3600000,
    updatedAt: now,
    messages: [
        {
            id: "demo-user",
            role: "user",
            content:
                "Help me plan a cozy Minecraft game night for five friends. We have a fresh survival world and about two hours.",
            createdAt: now - 60000,
        },
        {
            id: "demo-assistant",
            role: "assistant",
            model,
            status: "done",
            createdAt: now - 59000,
            content:
                "## A little adventure, a lot of good company\n\nHere’s a relaxed two-hour plan for your new world.\n\n### 1. Settle in · 20 minutes\nPick a riverside spot, gather supplies, and build a shared starter cabin. Give everyone a small job so nobody has to do all the mining.\n\n### 2. Make it yours · 50 minutes\nSplit into pairs for a friendly build challenge: a tiny café, a treehouse, or a bridge. Keep the materials simple and let the fifth player choose a theme.\n\n### 3. Take the scenic route · 30 minutes\nPack food and boats, then explore together. Mark interesting spots for your next session instead of rushing to the Nether.\n\n### 4. End around the campfire · 20 minutes\nTour the builds, share your best screenshots, and leave a little surprise for next time.\n\n**A nice server setting:** enable `keepInventory` if your group prefers a relaxed evening. You can change it in the Game Server panel.",
            stats: { tokens: 268, tokensPerSecond: 47.6, promptTokens: 842, contextLength: 32768 },
        },
    ],
};
// Public Minecraft identities, resolved from Mojang rather than invented UUIDs.
const roster = [];
for (const name of [...users, "C418", "xisumavoid"]) {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name}`, {
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
        throw new Error(`Mojang profile lookup failed for ${name}: ${response.status}`);
    const profile = await response.json();
    roster.push({
        name: profile.name,
        uuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"),
    });
}
function fake(req) {
    const p = req.params || {};
    if (
        req.action === "file:read" &&
        p.appId === "dev.paperboard.gameserver" &&
        ["usercache.json", "whitelist.json", "ops.json", "banned-players.json"].includes(
            p.targetPath,
        )
    )
        return {
            content: JSON.stringify(
                p.targetPath === "usercache.json"
                    ? roster
                    : p.targetPath === "whitelist.json"
                      ? roster.slice(0, 5)
                      : p.targetPath === "ops.json"
                        ? roster.slice(0, 1)
                        : [],
            ),
        };
    if (req.action === "config:get" && p.id === "dev.paperboard.botcreator")
        return { data: { configured: true, applicationId: "124800000000000100", commands } };
    if (req.action !== "actions:call") return undefined;
    const panel = p.panelId,
        a = p.action;
    if (panel === "dev.paperboard.gameserver") {
        if (a === "__getState") return { result: game };
        if (a === "query-online-players") return { result: users };
        if (a === "query-player-stats")
            return {
                result: game.playerStats[(p.args?.[0]?.name || "").toLowerCase()] || {
                    health: 20,
                    food: 20,
                    xpLevel: 32,
                    xpProgress: 0.42,
                },
            };
        if (a === "list-player-stats")
            return {
                result: roster.map((p, i) => ({
                    ...p,
                    deaths: 3 + i,
                    mobKills: 216 + i * 57,
                    playerKills: 0,
                    playTimeTicks: (7200 + i * 5800) * 20,
                    jumps: 3452 + i * 78,
                    blocksMined: 4128 + i * 220,
                    distanceCm: 847235 + i * 38000,
                })),
            };
    }
    if (panel === "dev.paperboard.botcreator") {
        if (a === "get-health") return { result: health };
        if (a === "get-bot-info")
            return {
                result: {
                    name: "Paperbot",
                    tag: "Paperbot#0420",
                    avatar: icon("P", "#7757d9"),
                    applicationId: "124800000000000100",
                    connected: true,
                    lastError: null,
                    recentMessages: [
                        ["Maple", "Game night starts at 7! Who’s joining?"],
                        ["Nova", "Count me in. I have a treehouse idea 🌿"],
                        ["Pixel", "/server"],
                        ["Paperbot", "Game Night is online · 5 players · Minecraft 1.21.11"],
                        ["Fern", "The new welcome command is so cute!"],
                        ["Cloud", "/poll Build a café or a bridge?"],
                    ].map(([author, content], i) => ({
                        author,
                        content,
                        channelId: "124800000000000010",
                        guildId: guilds[0].id,
                        messageId: "12480000000000002" + i,
                    })),
                },
            };
        if (a === "list-guilds") return { result: guilds };
        if (a === "get-guild-detail") {
            const g = guilds.find((x) => x.id === p.args?.[0]?.guildId) || guilds[0];
            return {
                result: {
                    ...g,
                    createdAt: "2024-04-12T12:00:00Z",
                    channels: [
                        "welcome",
                        "announcements",
                        "general",
                        "minecraft",
                        "build-showcase",
                        "voice-lounge",
                    ].map((name, i) => ({
                        id: "12480000000000001" + i,
                        name,
                        kind: i === 5 ? "voice" : "text",
                        parentId: null,
                        position: i,
                    })),
                    roles: [
                        {
                            id: "124800000000000201",
                            name: "Moderators",
                            color: 0x7962ee,
                            position: 3,
                            managed: false,
                        },
                        {
                            id: "124800000000000202",
                            name: "Builders",
                            color: 0x0d9d0d,
                            position: 2,
                            managed: false,
                        },
                        {
                            id: "124800000000000203",
                            name: "Friends",
                            color: 0x2981e5,
                            position: 1,
                            managed: false,
                        },
                    ],
                },
            };
        }
    }
    if (panel === "dev.paperboard.ai" && a === "ui-get-conversation") return { result: chat };
    return undefined;
}
(async () => {
    const zoom = process.env.CAPTURE_LEARN_HERO ? 1.5 : 1.25;
    const capture = await captureBrowser(zoom);
    const context = capture.context;
    try {
        await context.routeWebSocket(
            (url) => Number(url.port) === expectedPort,
            (ws) => {
                const server = ws.connectToServer();
                const pending = new Map();
                ws.onMessage((message) => {
                    let req;
                    try {
                        req = JSON.parse(message.toString());
                    } catch {
                        server.send(message);
                        return;
                    }
                    const replacement = fake(req);
                    if (replacement !== undefined) {
                        ws.send(
                            JSON.stringify({ type: "response", id: req.id, result: replacement }),
                        );
                        return;
                    }
                    if (
                        req.action === "actions:call" &&
                        req.params?.panelId === "dev.paperboard.ai" &&
                        req.params.action === "__getState"
                    ) {
                        if (pending.size >= 128) throw new Error("Too many screenshot requests");
                        pending.set(req.id, "ai");
                    }
                    server.send(message);
                });
                server.onMessage((message) => {
                    let reply;
                    try {
                        reply = JSON.parse(message.toString());
                    } catch {
                        ws.send(message);
                        return;
                    }
                    if (pending.has(reply.id)) {
                        pending.delete(reply.id);
                        const state = reply.result?.result;
                        if (state) {
                            state.conversations = [
                                {
                                    id: chat.id,
                                    title: chat.title,
                                    model,
                                    updatedAt: now,
                                    messageCount: 2,
                                },
                                ...[
                                    "Explain this Python script",
                                    "A weekend project idea",
                                    "Notes from my reading",
                                ].map((title, i) => ({
                                    id: "demo-chat-" + i,
                                    title,
                                    model,
                                    updatedAt: now - (i + 1) * 3600000,
                                    messageCount: 4,
                                })),
                            ];
                            state.models = [
                                ["qwen3:8b", "8B", 5.2],
                                ["llama3.2:3b", "3B", 2],
                                ["gemma3:4b", "4B", 3.3],
                            ].map(([name, parameterSize, gb]) => ({
                                name,
                                provider: "ollama",
                                sizeBytes: gb * 1e9,
                                parameterSize,
                                quantization: "Q4_K_M",
                                capabilities: [
                                    "completion",
                                    "tools",
                                    ...(name.startsWith("qwen")
                                        ? ["thinking"]
                                        : name.startsWith("gemma")
                                          ? ["vision"]
                                          : []),
                                ],
                            }));
                            state.settings.defaultModel = model;
                            state.runtime.status = "ready";
                            state.runtime.compute = [
                                {
                                    library: "Vulkan",
                                    name: "AMD Radeon RX 7800 XT",
                                    totalBytes: 16 * 1024 ** 3,
                                },
                            ];
                        }
                    }
                    ws.send(JSON.stringify(reply));
                });
                ws.onClose(() => pending.clear());
                server.onClose(() => pending.clear());
            },
        );
        const page = await context.newPage();
        await page.goto(origin);
        const metrics = await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
        }));
        if (Math.abs(metrics.width - 1600 / zoom) > 1 || Math.abs(metrics.height - 1200 / zoom) > 1 || Math.abs(metrics.dpr - zoom) > 0.01)
            throw new Error("Chrome native page zoom was not applied");
        for (const [name, id] of [
            ["Game Server", "gameserver"],
            ["Bot Creator", "botcreator"],
            ["AI", "ai"],
        ]) {
            await page.getByText(name, { exact: true }).click();
            const frame = await (
                await page.locator(`iframe[title="dev.paperboard.${id}"]`).elementHandle()
            ).contentFrame();
            await frame.locator("body").waitFor();
            await frame.waitForFunction(() => Boolean(window.__PAPERBOARD_CRANE));
            const grantedPort = await frame.evaluate(() => window.__PAPERBOARD_CRANE.port);
            if (grantedPort !== expectedPort)
                throw new Error("Refusing to capture a daemon outside the temporary install");
            await page.waitForTimeout(1500);
            if (process.env.CAPTURE_LEARN_HERO) {
                if (id === "gameserver") await frame.getByText("Overview", { exact: true }).click();
                await page.screenshot({ path: root + `learn-${id}.png` });
                continue;
            }
            if (id === "gameserver") {
                await frame.getByText("Overview", { exact: true }).click();
                await page.waitForTimeout(500);
                await page.screenshot({ path: root + "gameserver.png" });
                await frame.getByText("Plugins", { exact: true }).click();
                const search = frame.getByPlaceholder("Search Plugins");
                await search.fill("voice");
                await search.press("Enter");
                await frame
                    .getByText("Simple Voice Chat", { exact: true })
                    .first()
                    .waitFor({ timeout: 30000 });
                await frame.locator('img[src*="cdn.modrinth.com"]').first().waitFor();
                await frame
                    .locator('img[src*="cdn.modrinth.com"]')
                    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
                await page.screenshot({ path: root + "gameserver-plugins.png" });
                await frame.getByText("Players", { exact: true }).click();
                await page.waitForTimeout(1000);
                await frame.getByText("Notch", { exact: true }).click();
                await frame
                    .locator('img[src^="data:image/png"]')
                    .first()
                    .waitFor({ timeout: 30000 });
                await frame.waitForTimeout(800);
                const headers = frame.getByRole("heading", { name: /Online \(5\)|Offline \(2\)/i });
                if ((await headers.count()) !== 2)
                    throw new Error("Player section headings missing");
                const styles = await headers.evaluateAll((elements) =>
                    elements.map((element) => ({
                        transform: getComputedStyle(element).textTransform,
                        parentBackground: getComputedStyle(element.parentElement).backgroundColor,
                        rowBackground: getComputedStyle(
                            element.parentElement.querySelector('[role="option"]') ||
                                element.parentElement.querySelector("div"),
                        ).backgroundColor,
                    })),
                );
                if (
                    styles.some(
                        (style) =>
                            style.transform !== "uppercase" ||
                            style.parentBackground === "rgb(0, 0, 0)",
                    )
                )
                    throw new Error(
                        "Player headings must use uppercase section text on the card surface",
                    );
                await page.screenshot({ path: root + "gameserver-players.png" });
            }
            if (id === "botcreator") {
                await frame.getByText("Overview", { exact: true }).click();
                await page.waitForTimeout(500);
                await page.screenshot({ path: root + "botcreator.png" });
                await frame.getByText("Commands", { exact: true }).click();
                await page.waitForTimeout(500);
                await page.screenshot({ path: root + "botcreator-commands.png" });
                await frame.getByText("Servers", { exact: true }).click();
                await page.waitForTimeout(500);
                await page.screenshot({ path: root + "botcreator-servers.png" });
            }
            if (id === "ai") {
                await frame.getByText(chat.title, { exact: true }).click();
                await page.waitForTimeout(500);
                await page.screenshot({ path: root + "ai.png" });
                await frame.getByRole("button", { name: "Model: " + model }).click();
                await page.waitForTimeout(600);
                await page.screenshot({ path: root + "ai-models.png" });
                await frame.getByRole("dialog").press("Escape");
                await page.waitForTimeout(400);
                const codeChat = {
                    ...chat,
                    id: "demo-code",
                    title: "Explain this Python script",
                    messages: [
                        {
                            id: "code-user",
                            role: "user",
                            createdAt: now - 60000,
                            content:
                                "What does this function do, and is there a bug?\n\n```python\ndef average(values):\n    return sum(values) / len(values)\n```",
                        },
                        {
                            id: "code-assistant",
                            role: "assistant",
                            model,
                            status: "done",
                            createdAt: now - 59000,
                            content:
                                '## What it does\nIt adds up the numbers, then divides by how many there are. That gives you the arithmetic mean.\n\n```python\naverage([2, 4, 6])  # 4.0\n```\n\n## The edge case\nAn empty list divides by zero. Decide how your program should handle that case explicitly:\n\n```python\ndef average(values):\n    if not values:\n        raise ValueError("At least one value is required")\n    return sum(values) / len(values)\n```\n\nA clear error makes it easier for the caller to recover. You can also add a test for the empty list.',
                            stats: {
                                tokens: 190,
                                tokensPerSecond: 47.6,
                                promptTokens: 96,
                                contextLength: 32768,
                            },
                        },
                    ],
                };
                chat = codeChat;
                await frame.getByText("Explain this Python script", { exact: true }).click();
                await frame.getByText("What it does", { exact: true }).waitFor();
                await page.screenshot({ path: root + "ai-code.png" });
                chat = {
                    ...chat,
                    id: "demo-game-night",
                    title: "Minecraft server launch checklist",
                    messages: [
                        {
                            id: "plan-user",
                            role: "user",
                            createdAt: now - 60000,
                            content:
                                "Make a launch checklist for a small Minecraft server for friends. We want voice chat and a whitelist.",
                        },
                        {
                            id: "plan-assistant",
                            role: "assistant",
                            model,
                            status: "done",
                            createdAt: now - 59000,
                            content:
                                "## Before people join\n\n1. Pick a Minecraft version that everyone can run.\n2. Install Paper and start the server once to create its files.\n3. Enable the whitelist and add your friends.\n4. Install Simple Voice Chat and check its network requirements.\n\n## First session\n\n- Choose a spawn point and build a shared storage area.\n- Agree on difficulty and whether to keep inventory after death.\n- Check voice chat with one friend before inviting everyone.\n\n## Keep it running\n\nBack up the world before updates. Check plugin compatibility before changing Minecraft versions. Use an Actions flow to send a Discord message when the server starts.",
                            stats: {
                                tokens: 214,
                                tokensPerSecond: 47.6,
                                promptTokens: 128,
                                contextLength: 32768,
                            },
                        },
                    ],
                };
                await frame
                    .getByText("A little inspiration for game night", { exact: true })
                    .click();
                await frame.getByText("Before people join", { exact: true }).waitFor();
                await page.screenshot({ path: root + "ai-plan.png" });
            }
        }
    } finally {
        await capture.close();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
