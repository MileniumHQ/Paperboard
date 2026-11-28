import { describe, expect, test } from "bun:test";
import { testServer } from "./helpers/scope";
import { observeLine } from "../src/games/minecraft/observe";
import { handleProcessData, handleProcessExit } from "../src/service/lifecycle";

/** an offline scope fed console lines straight into the game's parser */
function feed(version: string, lines: string[], software = "paper") {
    const scope = testServer(
        { directory: "servers/parse", settings: { software, version } },
        { serverSoftware: software as never, serverVersion: version },
    );
    for (const line of lines) observeLine(scope, line);
    return scope;
}

const PAPER = (text: string) => `[12:00:00 INFO]: ${text}`;
const V26 = (text: string) => `[12:00:00] [Server thread/INFO]: System chat: ${text}`;

// Console parsing rejects spoofed server replies from player chat.
describe("console parsing", () => {
    test("a list reply sets the roster and cap, and a chatting player cannot spoof either", () => {
        const scope = feed("1.21.1", [PAPER("There are 2 of a max of 20 players online: Steve, Alex")]);
        expect(scope.state.onlinePlayers).toEqual(["steve", "alex"]);
        expect(scope.state.maxPlayers).toBe(20);
        observeLine(scope, PAPER("<Mallory> There are 9 of a max of 99 players online: alice, bob"));
        expect(scope.state.maxPlayers).toBe(20);
        expect(scope.state.onlinePlayers).toEqual(["steve", "alex"]);
        const v26 = feed("26.3", [V26("There are 0 of a max of 8 players online:")]);
        expect(v26.state.maxPlayers).toBe(8);
    });
});

// A game's output is published in batches; what the service says (a backup's
// stop, the run's end) must still come after the lines before it.
describe("a server's console", () => {
    test("shows the service's own lines after the output that came before them", () => {
        const server = testServer({ game: "valheim", directory: "servers/order" }, { serverStatus: "online" });
        handleProcessData(server, "Saving world\n");
        server.console.say("info", "[Server] Stopping to restore a backup...");
        handleProcessData(server, "World saved\nShutting down");
        handleProcessExit(server, 0);
        expect(server.state.serverEntries.map((e) => e.content)).toEqual(["Saving world", "[Server] Stopping to restore a backup...", "World saved", "Shutting down", "[Server] Process stopped."]);
    });
});
