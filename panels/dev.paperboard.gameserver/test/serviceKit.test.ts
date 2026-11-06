import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConsoleBuffer, exists, fileStamp, isLinked, linkFolder, redact, unlinkFolder, waitUntil } from "../src/games/serviceKit";
import { hostRoutes } from "../src/games/host";
import { palworld } from "../src/games/palworld";
import { palworldPlatform } from "../src/games/palworld/service";
import { tf2 } from "../src/games/tf2";
import { terraria } from "../src/games/terraria";
import { games } from "../src/games";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "service-kit-"));
afterAll(() => fs.rm(temp, { recursive: true, force: true }));

describe("game folders", () => {
    test("a link takes over what the game wrote in its place, then is left alone", async () => {
        const link = path.join(temp, "a", "install", "Saved");
        const target = path.join(temp, "a", "saved");
        await fs.mkdir(link, { recursive: true });
        await fs.writeFile(path.join(link, "Level.sav"), "world");
        await linkFolder(link, target);
        expect(await isLinked(link)).toBe(true);
        expect(await fs.readFile(path.join(target, "Level.sav"), "utf8")).toBe("world");
        expect(await fs.readFile(path.join(link, "Level.sav"), "utf8")).toBe("world");
        await linkFolder(link, target);
        expect(await isLinked(link)).toBe(true);
        await unlinkFolder(link);
        expect(await exists(link)).toBe(false);
        expect(await exists(path.join(target, "Level.sav"))).toBe(true);
    });

    test("the same file on both sides is refused and both copies stay", async () => {
        const link = path.join(temp, "b", "install", "Saved");
        const target = path.join(temp, "b", "saved");
        await fs.mkdir(link, { recursive: true });
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(link, "Level.sav"), "new");
        await fs.writeFile(path.join(target, "Level.sav"), "old");
        await expect(linkFolder(link, target)).rejects.toThrow("Level.sav is in both Saved in the game's folder and saved");
        expect(await fs.readFile(path.join(link, "Level.sav"), "utf8")).toBe("new");
        expect(await fs.readFile(path.join(target, "Level.sav"), "utf8")).toBe("old");
    });

    test("a real folder is the user's: unlinking leaves it", async () => {
        const folder = path.join(temp, "c", "addons");
        await fs.mkdir(folder, { recursive: true });
        await unlinkFolder(folder);
        expect(await exists(folder)).toBe(true);
        expect(await isLinked(folder)).toBe(false);
    });

    test("only a missing file counts as absent", async () => {
        expect(await exists(path.join(temp, "nothing"))).toBe(false);
        const locked = path.join(temp, "locked");
        await fs.mkdir(locked);
        await fs.chmod(locked, 0o000);
        try {
            // root reads anything; the refusal is only provable as a user
            if (process.getuid?.() !== 0) await expect(exists(path.join(locked, "inside"))).rejects.toThrow("EACCES");
        } finally { await fs.chmod(locked, 0o700); }
    });
});

describe("saves", () => {
    test("a stamp changes when a file is rewritten and refuses an empty one", async () => {
        const file = path.join(temp, "world.wld");
        await fs.writeFile(file, "one");
        const first = await fileStamp(file, "The world");
        await fs.writeFile(file, "two");
        expect(await fileStamp(file, "The world")).not.toBe(first);
        await fs.writeFile(file, "");
        await expect(fileStamp(file, "The world")).rejects.toThrow("The world is empty");
    });

    test("a wait ends when its check passes, or names what it waited for", async () => {
        let n = 0;
        await waitUntil(() => ++n >= 3, 1_000, "three checks", 1);
        expect(n).toBe(3);
        await expect(waitUntil(() => false, 20, "Palworld to write Level.sav", 5)).rejects.toThrow("Timed out waiting for Palworld to write Level.sav");
    });
});

describe("the console", () => {
    test("lines arrive together, marked as errors by the game's rule, with passwords hidden", async () => {
        let state = { serverEntries: [] as { type: string; content: string }[] };
        let updates = 0;
        const ctx = { get state() { return state; }, setState(patch: any) { updates++; state = { ...state, ...patch }; } } as any;
        const buffer = new ConsoleBuffer((line) => line.includes("ERROR"));
        buffer.push(ctx, redact("password is hunter2", ["hunter2", ""]));
        buffer.push(ctx, "ERROR: map missing");
        expect(updates).toBe(0);
        await new Promise((r) => setTimeout(r, 150));
        expect(updates).toBe(1);
        expect(state.serverEntries).toEqual([{ type: "info", content: "password is [redacted]" }, { type: "error", content: "ERROR: map missing" }]);
        buffer.push(ctx, "dropped");
        buffer.dispose();
        await new Promise((r) => setTimeout(r, 150));
        expect(updates).toBe(1);
    });

    test("a progress count shows as one line that counts up, not a line per step", async () => {
        let state = { serverEntries: [] as { type: string; content: string }[] };
        const ctx = { get state() { return state; }, setState(patch: any) { state = { ...state, ...patch }; } } as any;
        const buffer = new ConsoleBuffer(() => false);
        const wait = () => new Promise((r) => setTimeout(r, 150));
        // as Terraria prints a start
        buffer.push(ctx, "Resetting game objects 1%");
        buffer.push(ctx, "Resetting game objects 2%");
        await wait();
        buffer.push(ctx, "Resetting game objects 100%");
        for (let n = 1; n <= 100; n++) buffer.push(ctx, `Loading world data: ${n}%`);
        buffer.push(ctx, "Settling liquids 50%");
        await wait();
        buffer.push(ctx, "Settling liquids 100%");
        await wait();
        // a line written between two of a step's counts keeps the earlier count
        buffer.push(ctx, "Validating world save: 10%");
        await wait();
        state = { serverEntries: [...state.serverEntries, { type: "warn", content: "[Server] note" }] };
        buffer.push(ctx, "Validating world save: 20%");
        buffer.push(ctx, "Server started");
        buffer.push(ctx, "Players: 10% off at the shop");
        await wait();
        expect(state.serverEntries.map((e) => e.content)).toEqual([
            "Resetting game objects 100%",
            "Loading world data: 100%",
            "Settling liquids 100%",
            "Validating world save: 10%",
            "[Server] note",
            "Validating world save: 20%",
            "Server started",
            "Players: 10% off at the shop",
        ]);
    });

    test("a new world's generation counts up on one line per step, overall and step percent both moving", async () => {
        let state = { serverEntries: [] as { type: string; content: string }[] };
        const ctx = { get state() { return state; }, setState(patch: any) { state = { ...state, ...patch }; } } as any;
        const buffer = new ConsoleBuffer(() => false);
        const wait = () => new Promise((r) => setTimeout(r, 150));
        // as Terraria prints the first start of a new world
        buffer.push(ctx, "0.0% - Resetting - 0.0%");
        buffer.push(ctx, "0.4% - Resetting - 80.9%");
        await wait();
        for (let n = 0; n <= 99; n++) buffer.push(ctx, `95.${Math.floor(n / 10)}% - Clean up - ${n}.9%`);
        await wait();
        buffer.push(ctx, "99.9% - Final clean up - 92.9%");
        buffer.push(ctx, "100.0% - Final clean up - 100.0%");
        // then it reprints its last step between each count of saving and loading the world
        for (const count of ["Saving world data: 15%", "Saving world data: 89%", "Validating world save: 63%", "Resetting game objects 100%", "Loading world data: 30%"]) {
            buffer.push(ctx, "100.0% - Finalizing world - 0.0%");
            await wait();
            buffer.push(ctx, count);
        }
        buffer.push(ctx, "100.0% - Finalizing world - 0.0%");
        buffer.push(ctx, "Listening on port 7777");
        await wait();
        expect(state.serverEntries.map((e) => e.content)).toEqual([
            "0.4% - Resetting - 80.9%",
            "95.9% - Clean up - 99.9%",
            "100.0% - Final clean up - 100.0%",
            "Saving world data: 89%",
            "Validating world save: 63%",
            "Resetting game objects 100%",
            "Loading world data: 30%",
            "100.0% - Finalizing world - 0.0%",
            "Listening on port 7777",
        ]);
    });
});

describe("computers each game runs on", () => {
    const options = { software: "", version: "" };
    test("Linux and Windows on x64, nothing else, each refusal with a reason", () => {
        for (const game of [palworld, tf2, terraria]) {
            for (const os of ["linux", "win32"]) expect(game.hostSupport({ os, arch: "x64" }, options)).toEqual({ supported: true });
            for (const [os, arch] of [["darwin", "x64"], ["darwin", "arm64"], ["linux", "arm64"], ["win32", "arm64"]]) {
                const support = game.hostSupport({ os: os!, arch: arch! }, options);
                expect(support.supported).toBe(false);
                expect(support.reason).toContain(game.name);
            }
        }
        expect(hostRoutes("Test server", { os: ["linux"], arch: ["x64"] })({ os: "win32", arch: "x64" }, options).reason).toBe("The Test server runs on Linux, not Windows.");
    });

    test("every registered game answers for every computer", () => {
        for (const game of games) for (const os of ["linux", "win32", "darwin"]) for (const arch of ["x64", "arm64"]) {
            const support = game.hostSupport({ os, arch }, { software: "", version: "" });
            expect(support.supported || !!support.reason).toBe(true);
        }
    });

    test("Palworld runs its console build on Windows and the script on Linux, each with its own settings folder", () => {
        expect(palworldPlatform("win32")).toEqual({ configDir: "WindowsServer", executable: path.join("Pal", "Binaries", "Win64", "PalServer-Win64-Shipping-Cmd.exe"), args: ["Pal"] });
        expect(palworldPlatform("linux")).toEqual({ configDir: "LinuxServer", executable: "PalServer.sh", args: [] });
        expect(() => palworldPlatform("darwin")).toThrow("does not run on darwin");
    });
});
