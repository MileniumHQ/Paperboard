// service startup (bun test): a bot whose Discord login never finishes must not
// hold the service back from reporting ready, and a failing one is logged
import { describe, expect, it, spyOn } from "bun:test";
import { startBots } from "../src/service";

describe("starting the bots", () => {
    it("returns at once while a login hangs, and starts every bot", () => {
        const started: string[] = [];
        startBots(["stalled", "fine"], (id) => {
            started.push(id);
            return new Promise<void>(() => {}); // Discord waiting out a rate limit
        });
        expect(started).toEqual(["stalled", "fine"]);
    });

    it("logs a bot that fails to start instead of dropping it", async () => {
        const logged = spyOn(console, "error").mockImplementation(() => {});
        startBots(["broken"], async () => {
            throw new Error("Invalid token");
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(logged).toHaveBeenCalledWith("[DiscordService] starting a bot failed:", "Invalid token");
        logged.mockRestore();
    });
});
