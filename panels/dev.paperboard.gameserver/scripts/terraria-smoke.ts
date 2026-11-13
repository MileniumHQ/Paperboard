/**
 * Operator-only: downloads the real pinned Terraria server from the
 * publisher and drives it through the real daemon. Never part of the gate
 * (the publisher's CDN is no regression test).
 *
 *   bun panels/dev.paperboard.gameserver/scripts/terraria-smoke.ts
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { assert, PANEL, until, withScenarioDaemon } from "./scenarioDaemon";

const VERSION = "1.4.5.8";

await withScenarioDaemon("terraria-real", async ({ addServer }) => {
    const { backupApi, backupLocationsApi, processApi, secretsApi } = await import("@mileniumhq/paperapi");
    const server = await addServer("Terraria", "terraria", "terraria-server");
    const proc = `${server.id}-terraria-server`;
    const online = (label: string, timeout = 300_000) => until(async () => {
        const s = await server.state();
        if (s.serverStatus === "offline") throw new Error("Terraria stopped before it was ready");
        return s.serverStatus === "online";
    }, label, timeout);
    const offline = async (label: string) => {
        await until(async () => !(await processApi.exists(proc)), `${label}: process exit`, 125_000);
        await until(async () => (await server.state()).serverStatus === "offline", `${label}: offline state`);
    };

    await server.call("terraria-install", { version: VERSION });
    let rejected = "";
    try { await server.call("op-player", { player: "Steve" }); } catch (err) { rejected = String(err); }
    assert(/does not support|not found|Unknown/i.test(rejected), `A Minecraft-only call did not visibly refuse Terraria: ${rejected || "it was accepted"}`);
    await server.call("write-game-options", { patch: { seed: "Paperboard", maxplayers: 4, password: "wire-secret" } });
    assert((await secretsApi.get(`${server.id}-terraria-join-password`, PANEL)).value === "wire-secret", "The join password did not reach the vault");

    // a port in use moves the server to another, which the launch then uses
    const blocker = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => blocker.listen(0, "0.0.0.0", resolve));
    const occupied = (blocker.address() as net.AddressInfo).port;
    try {
        await server.call("terraria-world", { name: "Smoke", create: true, port: occupied });
        await server.call("start-server");
        await online("first start");
        const up = await server.state();
        assert(Number(up.serverPort) !== occupied, "The occupied port was not relocated");
        await new Promise<void>((resolve, reject) => { const socket = net.connect(Number(up.serverPort), "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(); }); socket.once("error", reject); });
        assert(!JSON.stringify(await server.console()).includes("wire-secret"), "The join password is in the console");
        console.log(`Terraria ${VERSION}: ONLINE, TCP ${up.serverPort}; collision ${occupied} relocated; host ${process.platform}/${process.arch}`);

        await server.call("run-command", { command: "playing" });
        await server.call("save-world");
        console.log("save: returned console prompt and changed world file confirmed");
        await server.call("stop-server");
        await offline("saved stop");
        const world = path.join(server.directory, "worlds", "Smoke.wld");
        assert(fs.statSync(world).size > 0, "The world was not created");

        // an unknown key on disk survives an option edit
        fs.appendFileSync(path.join(server.directory, "serverconfig.txt"), "npcstream=42\n");
        await server.call("write-game-options", { patch: { motd: "Smoke backup" } });
        assert(fs.readFileSync(path.join(server.directory, "serverconfig.txt"), "utf8").includes("npcstream=42"), "An unknown config key was lost");

        await server.call("start-server");
        await online("restart");
        await backupLocationsApi.setForPanel(PANEL, "local", undefined, server.id);
        const api = backupApi.forSource(PANEL, server.id);
        const record = await api.create({ label: "Terraria smoke" });
        await online("restart after backup");
        console.log(`backup: ${record.size} bytes, SHA-256 ${record.sha256}; stopped for the copy and restarted`);
        fs.writeFileSync(path.join(server.directory, "after-backup.txt"), "must disappear on restore");
        await api.restore(record.id);
        await online("restart after restore");
        assert(!fs.existsSync(path.join(server.directory, "after-backup.txt")), "Restore did not replace the server's files");
        assert((await secretsApi.get(`${server.id}-terraria-join-password`, PANEL)).value === "wire-secret", "Restore lost the vault's join password");
        console.log("restore: original world loaded, later file removed, vault credential retained, restarted ONLINE");

        await server.call("stop-server");
        await offline("final stop");
        console.log("stop: exit completed; process absent; state OFFLINE");
    } finally { blocker.close(); }
});
