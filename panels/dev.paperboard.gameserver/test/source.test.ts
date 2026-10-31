import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";
import { decodePackets, encodePacket, SourceRcon } from "../src/games/source/rcon";
import { consoleLine, isErrorLine, linePlayer, parseLogLine, parseStatus, steamId } from "../src/games/source/log";

// lines as the Team Fortress 2 dedicated server (build 11191711) printed them
const STATUS = `hostname: Probe
version : 11191711/24 11191711 secure
udp/ip  : ?.?.?.?:?  (public IP from Steam: 15.218.29.167)
steamid : [A:1:934219783:52212] (90296242314088455)
account : not logged in  (No account specified)
map     : ctf_2fort at: 0 x, 0 y, 0 z
tags    : ctf
players : 1 humans, 2 bots (12 max)
edicts  : 695 used of 2048 max
# userid name                uniqueid            connected ping loss state  adr
#      2 "Mega Baboon"       BOT                                     active
#      3 "Kill Me"           BOT                                     active
#      4 "Pyro \\"Main\\""      [U:1:123456789]     01:02:03   45    0 active 192.168.1.20:27005
`;

describe("Source log lines", () => {
    test("joins, leaves, chat and renames are read with the player's user id", () => {
        expect(parseLogLine('L 10/31/2026 - 09:18:21: "WITCH<2><BOT><>" connected, address "none"')).toEqual({ kind: "connected", player: { name: "WITCH", userId: 2, steamId: "BOT", team: "" }, address: "none" });
        // Source prints this one without the name
        expect(parseLogLine('L 10/31/2026 - 09:18:21: "<2><BOT><>" entered the game')).toEqual({ kind: "entered", player: { name: "", userId: 2, steamId: "BOT", team: "" } });
        expect(parseLogLine('L 10/31/2026 - 09:20:25: "Kill Me<3><BOT><Blue>" disconnected (reason ""Kicked by Paperboard"")')).toMatchObject({ kind: "disconnected", reason: '"Kicked by Paperboard"' });
        expect(parseLogLine('L 10/31/2026 - 09:16:56: "Console<0><Console><Console>" say "hello from rcon"')).toEqual({ kind: "say", player: { name: "Console", userId: 0, steamId: "Console", team: "Console" }, team: false, text: "hello from rcon" });
        expect(parseLogLine('L 10/31/2026 - 09:16:56: "A <b>\\"c<5><[U:1:9]><Red>" say_team "go "now""')).toMatchObject({ kind: "say", team: true, text: 'go "now"', player: { name: 'A <b>\\"c', userId: 5, steamId: "[U:1:9]" } });
        expect(parseLogLine('L 10/31/2026 - 09:16:56: "Old<5><[U:1:9]><Red>" changed name to "New"')).toMatchObject({ kind: "renamed", name: "New" });
        expect(parseLogLine('L 10/31/2026 - 09:18:19: Started map "ctf_2fort" (CRC "a70bdd508912c2098fdcdfc9e2a53147")')).toEqual({ kind: "map", map: "ctf_2fort" });
        expect(parseLogLine('L 10/31/2026 - 09:35:51: "IvanTheSpaceBiker<2><BOT><Unassigned>" joined team "Red"')).toMatchObject({ kind: "team", team: "Red", player: { userId: 2 } });
        expect(parseLogLine('L 10/31/2026 - 09:18:21: "WITCH<2><BOT><Blue>" changed role to "medic"')).toBeNull();
        expect(parseLogLine("Console: hello from rcon")).toBeNull();
        expect(linePlayer('L 10/31/2026 - 12:28:19: "Soulless<7><BOT><Red>" triggered "kill assist" against "ZAWMBEEZ<4><BOT><Blue>"')).toEqual({ name: "Soulless", userId: 7, steamId: "BOT", team: "Red" });
        expect(consoleLine('L 10/31/2026 - 12:28:19: "Soulless<7><BOT><Red>" triggered "kill assist"')).toBe('[12:28:19] "Soulless<7><BOT><Red>" triggered "kill assist"');
        expect(consoleLine("Server is hibernating")).toBe("Server is hibernating");
    });

    test("a status reply lists bots and players, quoted names included", () => {
        const status = parseStatus(STATUS);
        expect(status).toMatchObject({ hostname: "Probe", version: "11191711", map: "ctf_2fort", humans: 1, bots: 2, maxPlayers: 12 });
        expect(status.players).toEqual([
            { userId: 2, name: "Mega Baboon", steamId: "BOT", connected: "", ping: 0, state: "active", address: "" },
            { userId: 3, name: "Kill Me", steamId: "BOT", connected: "", ping: 0, state: "active", address: "" },
            { userId: 4, name: 'Pyro \\"Main\\"', steamId: "[U:1:123456789]", connected: "01:02:03", ping: 45, state: "active", address: "192.168.1.20:27005" },
        ]);
        expect(() => parseStatus("Unknown command")).toThrow("not in the expected format");
        expect(steamId("[U:1:123]")).toBe("[U:1:123]");
        expect(() => steamId("[U:1:1]; quit")).toThrow("Steam id");
    });
});

test("failures are told from library chatter that mentions an error", () => {
    expect(isErrorLine("qhull precision error: Only 4 facets remain.  Can not merge another")).toBe(false);
    expect(isErrorLine("Rcon auth failed from rcon whitelist address 127.0.0.1:49390")).toBe(false);
    expect(isErrorLine("Host_Error: Couldn't spawn server maps/pl_upward.bsp")).toBe(true);
    expect(isErrorLine("Failed to load $DYNAMIC model")).toBe(true);
    // printed on every healthy start
    expect(isErrorLine("[S_API FAIL] Tried to access Steam interface SteamUtils010 before SteamAPI_Init succeeded.")).toBe(false);
});

describe("Source RCON", () => {
    const servers: net.Server[] = [];
    afterEach(() => { for (const s of servers.splice(0)) s.close(); });

    /** An RCON server over real TCP: answers like srcds, splitting long replies over packets. */
    async function rconServer(password: string, replies: Record<string, string>) {
        const seen: string[] = [];
        const server = net.createServer((socket) => {
            let buffer = Buffer.alloc(0);
            let authed = false;
            socket.on("data", (chunk) => {
                const { packets, rest } = decodePackets(Buffer.concat([buffer, chunk]));
                buffer = rest;
                for (const p of packets) {
                    if (p.type === 3) {
                        authed = p.body === password;
                        socket.write(encodePacket(p.id, 0, ""));
                        socket.write(encodePacket(authed ? p.id : -1, 2, ""));
                    } else if (p.type === 2 && authed) {
                        seen.push(p.body);
                        const reply = replies[p.body] ?? `Unknown command "${p.body}"\n`;
                        for (let i = 0; i < reply.length; i += 4000) socket.write(encodePacket(p.id, 0, reply.slice(i, i + 4000)));
                    } else if (p.type === 0) {
                        // srcds mirrors the empty packet, then sends one more
                        socket.write(encodePacket(p.id, 0, ""));
                        socket.write(encodePacket(p.id, 0, "\u0000\u0001\u0000\u0000"));
                    }
                }
            });
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        return { port: (server.address() as net.AddressInfo).port, seen };
    }

    test("commands run in order and a reply over many packets arrives whole", async () => {
        const big = "x".repeat(10_000) + "\n";
        const { port, seen } = await rconServer("secret", { status: STATUS, cvarlist: big });
        const rcon = new SourceRcon(port, "secret", "TF2");
        const [a, b, c] = await Promise.all([rcon.exec("status"), rcon.exec("cvarlist"), rcon.exec("echo")]);
        expect(a).toBe(STATUS);
        expect(b).toBe(big);
        expect(c).toBe('Unknown command "echo"\n');
        expect(seen).toEqual(["status", "cvarlist", "echo"]);
        rcon.close();
    });

    test("a wrong password, a closed port and a second line are refused", async () => {
        const { port } = await rconServer("secret", {});
        await expect(new SourceRcon(port, "wrong", "TF2").exec("status")).rejects.toThrow("TF2 refused Paperboard's RCON password");
        const closed = net.createServer();
        await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const free = (closed.address() as net.AddressInfo).port;
        await new Promise((resolve) => closed.close(resolve));
        await expect(new SourceRcon(free, "secret", "TF2").exec("status")).rejects.toThrow(`TF2 did not answer on RCON port ${free}`);
        expect(() => new SourceRcon(port, "secret").exec("say hi\nquit")).toThrow("single line");
    });

    test("a server that resets the connection as it quits reads as closed, not as a failure", async () => {
        const server = net.createServer((socket) => {
            socket.on("data", (chunk) => {
                for (const p of decodePackets(chunk).packets) {
                    if (p.type === 3) { socket.write(encodePacket(p.id, 0, "")); socket.write(encodePacket(p.id, 2, "")); }
                    else if (p.type === 2) socket.resetAndDestroy();
                }
            });
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const rcon = new SourceRcon((server.address() as net.AddressInfo).port, "secret", "TF2");
        await expect(rcon.exec("quit")).rejects.toThrow("TF2 closed the RCON connection");
    });
});
