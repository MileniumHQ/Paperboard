import { describe, expect, test } from "bun:test";
import * as net from "node:net";
import { decodePackets, encodePacket, passwordReadAsTls, SourceRcon } from "../src/games/source/rcon";
import { isErrorLine, isShaderNoise } from "../src/games/source/log";

const AUTH = 3;

/** a Source RCON server on loopback; `answer` says what a command gets, and whether its reply is ended */
async function rconPeer(answer: (command: string) => { reply: string; end: boolean }) {
    const commands: string[] = [];
    const server = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        let ended = true;
        socket.on("data", (chunk) => {
            const decoded = decodePackets(Buffer.concat([buffer, chunk]));
            buffer = decoded.rest;
            for (const packet of decoded.packets) {
                if (packet.type === AUTH) {
                    socket.write(encodePacket(packet.id, 0, ""));
                    socket.write(encodePacket(packet.id, 2, ""));
                } else if (packet.type === 2) {
                    commands.push(packet.body);
                    const { reply, end } = answer(packet.body);
                    ended = end;
                    socket.write(encodePacket(packet.id, 0, reply));
                } else if (ended) socket.write(encodePacket(packet.id, 0, ""));
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { port: (server.address() as net.AddressInfo).port, commands, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

// What the real Garry's Mod server does to RCON, measured on build 26623757.
describe("Source RCON against a server's quirks", () => {
    test("a command whose packet would begin like a TLS hello is sent a space longer, and such a password is told apart", async () => {
        const peer = await rconPeer((command) => ({ reply: `ran ${command}`, end: true }));
        try {
            const rcon = new SourceRcon(peer.port, "secret");
            // 12 bytes: the packet's size byte is 0x16, which Garry's Mod drops the connection for
            expect(await rcon.exec("sbox_godmode")).toBe("ran sbox_godmode ");
            expect(await rcon.exec("sbox_noclip")).toBe("ran sbox_noclip");
            expect(await rcon.exec("x".repeat(268))).toBe(`ran ${"x".repeat(268)} `);
            rcon.close();
            expect(peer.commands).toEqual(["sbox_godmode ", "sbox_noclip", `${"x".repeat(268)} `]);
            expect([passwordReadAsTls("abcdefghijkl"), passwordReadAsTls("abcdefghijk"), passwordReadAsTls("abcdefghijklm")]).toEqual([true, false, false]);
        } finally {
            await peer.close();
        }
    });

    test("only the shader libraries a dedicated server never uses are left out of the console; any other failure stays", () => {
        for (const noise of ["#Failed to load /srv/install/bin/linux64/stdshader_dx9.so: (null)", "#Failed to load game_shader_generic_garrysmod.so: (null)", "#Failed to load stdshader_dbg.so: (null)\r"]) expect(isShaderNoise(noise)).toBe(true);
        for (const real of ["#Failed to load /srv/install/bin/linux64/engine.so: (null)", "Failed to load stdshader_dx9.so", "#Failed to load stdshader_dx9.so: wrong ELF class", "Host_Error: Map is missing", "CModelLoader::Map_IsValid:  No such map 'maps/x.bsp'"]) expect(isShaderNoise(real)).toBe(false);
        expect(isErrorLine("Host_Error: Map is missing")).toBe(true);
    });

    test("a reply whose end the server dropped is returned once it goes quiet, and the connection carries on", async () => {
        const peer = await rconPeer((command) => ({ reply: `ran ${command}`, end: command !== "bot" }));
        try {
            const rcon = new SourceRcon(peer.port, "secret");
            expect(await rcon.exec("bot")).toBe("ran bot");
            expect(await rcon.exec("status")).toBe("ran status");
            rcon.close();
        } finally {
            await peer.close();
        }
    });
});
