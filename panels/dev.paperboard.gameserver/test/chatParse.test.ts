// Chat lines as each server family prints them. Forge and NeoForge put the
// logger name in its own bracket before the colon; without accepting it the
// Chat tab and the chat-message trigger stay silent on every modded server.
import { expect, test } from "bun:test";
import { parseChatMessage } from "../src/lib/logs";

test("vanilla/Paper chat line", () => {
    expect(parseChatMessage("[23:45:57] [Server thread/INFO]: <Steve> hello there")).toMatchObject({
        sender: "Steve",
        content: "hello there",
        timestamp: "23:45:57",
    });
});

test("Forge/NeoForge chat line with the logger bracket", () => {
    // shape copied from a NeoForge 21.1.256 server log
    expect(
        parseChatMessage("[23:45:57] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> hello there"),
    ).toMatchObject({ sender: "Steve", content: "hello there" });
    expect(
        parseChatMessage("[23:45:57] [Server thread/INFO] [minecraft/MinecraftServer]: [Not Secure] <Alex> hi"),
    ).toMatchObject({ sender: "Alex", content: "hi" });
    expect(
        parseChatMessage("[23:45:57] [Server thread/INFO] [minecraft/MinecraftServer]: Steve joined the game")?.text,
    ).toBe("Steve joined the game");
});

test("ordinary Forge log lines are not chat", () => {
    expect(
        parseChatMessage('[23:45:57] [Server thread/INFO] [minecraft/DedicatedServer]: Done (4.175s)! For help, type "help"'),
    ).toBeNull();
    expect(parseChatMessage("[23:45:57] [Server thread/WARN] [minecraft/MinecraftServer]: <Steve> hi")).toBeNull();
});
