import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    checkedPermission,
    isClipboardPermission,
    isScreenRequest,
    mediaPermissions,
    panelAsker,
    PanelPermissionStore,
    type PanelPermission,
    type PermissionAnswer,
} from "../src/main/panelPermissions";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function storeFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-perms-"));
    dirs.push(dir);
    return path.join(dir, "local", "panel-permissions.json");
}

/** an asker that answers `answer` and counts what it was asked */
function asker(answer: PermissionAnswer | null) {
    const asked: PanelPermission[][] = [];
    return { asked, ask: async (p: PanelPermission[]) => (asked.push(p), answer) };
}

describe("what a panel asks for", () => {
    it("reads getUserMedia's media kinds as the microphone and the camera", () => {
        expect(mediaPermissions("media", ["audio"])).toEqual(["microphone"]);
        expect(mediaPermissions("media", ["video"])).toEqual(["camera"]);
        expect(mediaPermissions("media", ["audio", "video"])).toEqual(["microphone", "camera"]);
        expect(mediaPermissions("media", [])).toBeNull();
        expect(mediaPermissions("media", undefined)).toBeNull();
        expect(mediaPermissions("geolocation", undefined)).toBeNull();
        expect(checkedPermission("media", "audio")).toBe("microphone");
        expect(checkedPermission("media", "video")).toBe("camera");
        expect(checkedPermission("notifications", undefined)).toBeNull();
    });

    it("tells getDisplayMedia (media with no kinds) from getUserMedia", () => {
        expect(isScreenRequest("media", [])).toBe(true);
        expect(isScreenRequest("display-capture", undefined)).toBe(true);
        expect(isScreenRequest("media", ["video"])).toBe(false);
        expect(isScreenRequest("media", undefined)).toBe(false);
    });

    it("knows the panel behind a panel origin, and nothing else", () => {
        expect(panelAsker("panel://local.dev.paperboard.agents")).toEqual({ computerId: "local", panelId: "dev.paperboard.agents" });
        expect(panelAsker("panel://local.dev.paperboard.agents/index.html")).toEqual({ computerId: "local", panelId: "dev.paperboard.agents" });
        for (const origin of ["paperboard://shell", "https://accounts.google.com", "", "null"]) expect(panelAsker(origin)).toBeNull();
    });

    it("keeps the clipboard out of it", () => {
        for (const p of ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]) expect(isClipboardPermission(p)).toBe(true);
        expect(isClipboardPermission("media")).toBe(false);
    });
});

describe("your answers", () => {
    it("asks once, keeps a yes, and doesn't ask again — even after a restart", async () => {
        const file = storeFile();
        const yes = asker("allowed");
        expect(await new PanelPermissionStore(file).decide("dev.paperboard.agents", ["microphone"], yes.ask)).toBe(true);
        expect(yes.asked).toEqual([["microphone"]]);

        const later = new PanelPermissionStore(file);
        const never = asker("denied");
        expect(await later.decide("dev.paperboard.agents", ["microphone"], never.ask)).toBe(true);
        expect(never.asked).toEqual([]);
        expect(later.get("dev.paperboard.agents", "microphone")).toBe("allowed");
    });

    it("keeps a no, so the panel is refused without asking", async () => {
        const store = new PanelPermissionStore(storeFile());
        expect(await store.decide("dev.example", ["camera"], asker("denied").ask)).toBe(false);
        const again = asker("allowed");
        expect(await store.decide("dev.example", ["camera"], again.ask)).toBe(false);
        expect(again.asked).toEqual([]);
    });

    it("is per panel: one panel's yes isn't another's", async () => {
        const store = new PanelPermissionStore(storeFile());
        await store.decide("dev.one", ["microphone"], asker("allowed").ask);
        const other = asker("denied");
        expect(await store.decide("dev.two", ["microphone"], other.ask)).toBe(false);
        expect(other.asked).toEqual([["microphone"]]);
    });

    it("a question closed without an answer refuses this once and asks next time", async () => {
        const store = new PanelPermissionStore(storeFile());
        expect(await store.decide("dev.example", ["screen"], asker(null).ask)).toBe(false);
        expect(store.get("dev.example", "screen")).toBeUndefined();
        const again = asker("allowed");
        expect(await store.decide("dev.example", ["screen"], again.ask)).toBe(true);
        expect(again.asked).toEqual([["screen"]]);
    });

    it("asks only about what's unanswered, and a no to any part refuses the lot", async () => {
        const store = new PanelPermissionStore(storeFile());
        await store.decide("dev.example", ["microphone"], asker("allowed").ask);
        const both = asker("allowed");
        expect(await store.decide("dev.example", ["microphone", "camera"], both.ask)).toBe(true);
        expect(both.asked).toEqual([["camera"]]);

        store.set("dev.example", "camera", "denied");
        expect(await store.decide("dev.example", ["microphone", "camera"], asker("allowed").ask)).toBe(false);
    });

    it("asks one question for requests that arrive together", async () => {
        const store = new PanelPermissionStore(storeFile());
        let release!: (a: PermissionAnswer) => void;
        let asks = 0;
        const ask = () => (asks++, new Promise<PermissionAnswer>((r) => (release = r)));
        const a = store.decide("dev.example", ["microphone"], ask);
        const b = store.decide("dev.example", ["microphone"], ask);
        release("allowed");
        expect(await Promise.all([a, b])).toEqual([true, true]);
        expect(asks).toBe(1);
    });

    it("changing an answer in settings is kept and heard", async () => {
        const file = storeFile();
        const store = new PanelPermissionStore(file);
        let heard = 0;
        store.onChange(() => heard++);
        store.set("dev.example", "microphone", "allowed");
        store.set("dev.example", "microphone", "denied");
        expect(heard).toBe(2);
        expect(new PanelPermissionStore(file).list()).toEqual([{ panelId: "dev.example", permission: "microphone", answer: "denied" }]);
    });

    it("an unreadable answers file is an error, not 'nothing allowed'", async () => {
        const file = storeFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{ not json");
        const store = new PanelPermissionStore(file);
        expect(() => store.list()).toThrow(/aren't valid JSON/);
        await expect(store.decide("dev.example", ["microphone"], asker("allowed").ask)).rejects.toThrow(/aren't valid JSON/);
    });
});
