// Palworld's chat lines (bun test). The chat line is the Text
// format PalServer-Linux-Shipping 1.0.5.102999 builds from its own format
// strings, "[%s] [CHAT]" then "%s <%s> %s", with the time written as the
// "[%Y-%m-%d %H:%M:%S] [LOG]" lines the same build printed in a real run.
import { describe, expect, test } from "bun:test";
import { parseChat } from "../src/games/palworld/chat";

describe("Palworld chat lines", () => {
    test("a player's message is split into who said it and what", () => {
        expect(parseChat("[2026-10-31 13:00:00] [CHAT] <Pal Tamer> catching a Lamball", [])).toEqual({ sender: "Pal Tamer", content: "catching a Lamball" });
        expect(parseChat("[2026-10-31 13:00:00] [CHAT] <Tails> a > b and <c> d", [])).toEqual({ sender: "Tails", content: "a > b and <c> d" });
    });

    test("a name with '> ' in it is read from the players who are online", () => {
        const line = "[2026-10-31 13:00:00] [CHAT] <odd> name> hello";
        expect(parseChat(line, ["odd> name"])).toEqual({ sender: "odd> name", content: "hello" });
        expect(parseChat(line, [])).toEqual({ sender: "odd", content: "name> hello" });
    });

    test("other console lines are not chat", () => {
        for (const line of [
            "[2026-10-31 12:56:34] [LOG] REST accessed endpoint /v1/api/info OK",
            "[2026-10-31 12:56:34] [LOG] Pal Tamer joined the server. (User id: steam_76561190000000001, Player id: 1)",
            "Running Palworld dedicated server on :8211",
            "<Pal Tamer> a player typing the format by hand",
            "",
        ]) expect(parseChat(line, [])).toBeNull();
    });

    test("a chat line in a shape nobody knows is refused, not guessed", () => {
        expect(() => parseChat("[2026-10-31 13:00:00] [CHAT] no angle brackets", [])).toThrow("Unrecognised chat line");
    });
});
