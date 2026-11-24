// The person's own ssh files, read as `ssh` reads them: known_hosts (hashed
// names, ports, patterns, @revoked, @cert-authority) and the client config
// (aliases, first value wins, Include, Match skipped).
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { utils } from "ssh2";
import { checkHostKey, fingerprintOf, keyTypeOf, knownHostName } from "../../src/main/computerSetup/knownHosts";
import { resolveSshTarget } from "../../src/main/computerSetup/sshConfig";
import { tempDir } from "testkit/fs";
import { ed25519Pair } from "./sshKeys";

function publicBlob(): Buffer {
    const parsed = utils.parseKey(ed25519Pair().public);
    if (parsed instanceof Error) throw parsed;
    return (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH();
}

const line = (hosts: string, key: Buffer, marker = "") => `${marker ? `${marker} ` : ""}${hosts} ${keyTypeOf(key)} ${key.toString("base64")} comment`;

function hashed(name: string): string {
    const salt = crypto.randomBytes(20);
    return `|1|${salt.toString("base64")}|${crypto.createHmac("sha1", salt).update(name).digest("base64")}`;
}

describe("known_hosts", () => {
    const key = publicBlob();
    const other = publicBlob();

    test("a fingerprint is SHA256 and unpadded base64, as ssh-keygen prints it", () => {
        expect(fingerprintOf(key)).toBe(`SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`);
        expect(fingerprintOf(key)).not.toContain("=");
        expect(keyTypeOf(key)).toBe("ssh-ed25519");
    });

    test("a hashed name matches its host, and only its host", () => {
        const text = `# a comment\n\n${line(hashed("box.local"), key)}\n`;
        expect(checkHostKey(text, "box.local", 22, key)).toEqual({ kind: "known" });
        expect(checkHostKey(text, "BOX.local", 22, other)).toEqual({ kind: "changed", knownTypes: ["ssh-ed25519"] });
        expect(checkHostKey(text, "other.local", 22, other)).toEqual({ kind: "new" });
        expect(checkHostKey(text, "box.local", 2222, other)).toEqual({ kind: "new" });
        const hashedPort = line(hashed(knownHostName("box.local", 2222)), key);
        expect(checkHostKey(hashedPort, "box.local", 2222, key)).toEqual({ kind: "known" });
    });

    test("[host]:port names a port other than 22, and a bare name only port 22", () => {
        const text = `${line("[box.local]:2222", key)}\n${line("box.local", other)}\n`;
        expect(checkHostKey(text, "box.local", 2222, key)).toEqual({ kind: "known" });
        expect(checkHostKey(text, "box.local", 2222, other)).toEqual({ kind: "changed", knownTypes: ["ssh-ed25519"] });
        expect(checkHostKey(text, "box.local", 22, other)).toEqual({ kind: "known" });
        expect(checkHostKey(text, "box.local", 2200, key)).toEqual({ kind: "new" });
    });

    test("patterns: comma lists and wildcards match, a negated pattern takes its host out", () => {
        const text = `${line("*.lan,!printer.lan,192.168.1.?", key)}\n`;
        expect(checkHostKey(text, "nas.lan", 22, key)).toEqual({ kind: "known" });
        expect(checkHostKey(text, "192.168.1.5", 22, other).kind).toBe("changed");
        expect(checkHostKey(text, "192.168.1.50", 22, other)).toEqual({ kind: "new" });
        expect(checkHostKey(text, "printer.lan", 22, other)).toEqual({ kind: "new" });
    });

    // Inventory: Security — a host key marked @revoked is refused even when another line for the host lists it.
    test("a revoked key is refused even beside a line that lists it", () => {
        const text = `${line("box.local", key)}\n${line("*", key, "@revoked")}\n`;
        expect(checkHostKey(text, "box.local", 22, key)).toEqual({ kind: "revoked" });
        expect(checkHostKey(text, "box.local", 22, other)).toEqual({ kind: "changed", knownTypes: ["ssh-ed25519"] });
    });

    test("a certificate authority for the host is a clear error; one for other hosts doesn't matter", () => {
        const text = `${line("*.corp", key, "@cert-authority")}\n`;
        expect(() => checkHostKey(text, "build.corp", 22, other)).toThrow("certificate-authority host keys");
        expect(checkHostKey(text, "box.local", 22, other)).toEqual({ kind: "new" });
    });

    test("a malformed line or an unknown marker is passed over", () => {
        const text = `box.local ssh-ed25519\n@future box.local ${keyTypeOf(key)} ${key.toString("base64")}\nbox.local ssh-ed25519 not*base64\n`;
        expect(checkHostKey(text, "box.local", 22, key)).toEqual({ kind: "new" });
    });
});

describe("ssh config", () => {
    function sshDir(config: string, files: Record<string, string> = {}): string {
        const dir = path.join(tempDir("pb-ssh-home-"), ".ssh");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "config"), config);
        for (const [name, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
            fs.writeFileSync(path.join(dir, name), text);
        }
        return dir;
    }

    test("an alias resolves to its HostName, User, Port and IdentityFile, tokens expanded", () => {
        const dir = sshDir([
            "Host nas",
            "    HostName 192.168.1.20",
            "    User=admin",
            "    Port 2222",
            "    IdentityFile ~/.ssh/id_%h_%r",
            '    IdentityFile "keys/with space"',
            "Host proxy-*",
            "    HostName %h.internal",
        ].join("\n"));
        expect(resolveSshTarget("nas", { sshDir: dir, localUser: "me" })).toEqual({
            hostName: "192.168.1.20",
            port: 2222,
            user: "admin",
            identityFiles: [path.join(dir, "id_192.168.1.20_admin"), path.join(dir, "keys", "with space")],
        });
        expect(resolveSshTarget("NAS", { sshDir: dir, localUser: "me" }).hostName).toBe("192.168.1.20");
        expect(resolveSshTarget("proxy-1", { sshDir: dir, localUser: "me" }).hostName).toBe("proxy-1.internal");
    });

    test("an unknown host connects as typed, on 22, as the local user, with the default keys that exist", () => {
        const dir = sshDir("", { id_rsa: "key", id_ed25519: "key" });
        expect(resolveSshTarget("box.local", { sshDir: dir, localUser: "me" })).toEqual({
            hostName: "box.local",
            port: 22,
            user: "me",
            identityFiles: [path.join(dir, "id_ed25519"), path.join(dir, "id_rsa")],
        });
    });

    test("the first value wins, negation excludes, and Match blocks are skipped whole", () => {
        const dir = sshDir([
            "User everyone-first",
            "Host *.lan !secret.lan",
            "    User lan-user",
            "    Port 2200",
            "Match host *.lan",
            "    User matched",
            "    HostName nowhere",
            "Host *",
            "    User fallback",
            "    Port 22",
        ].join("\n"));
        expect(resolveSshTarget("nas.lan", { sshDir: dir, localUser: "me" })).toMatchObject({ hostName: "nas.lan", user: "everyone-first", port: 2200 });
        const secret = resolveSshTarget("secret.lan", { sshDir: dir, localUser: "me" });
        expect(secret).toMatchObject({ hostName: "secret.lan", user: "everyone-first", port: 22 });
    });

    test("Include pulls in files relative to the ssh folder, globs sorted, where it stands", () => {
        const dir = sshDir([
            "Include conf.d/*.conf",
            "Host nas",
            "    User from-main",
        ].join("\n"), {
            "conf.d/10-nas.conf": "Host nas\n    HostName 10.0.0.2\n    User from-include\n",
            "conf.d/20-nas.conf": "Host nas\n    HostName 10.0.0.3\n    Port 2022\n",
            "conf.d/ignored.txt": "Host nas\n    HostName 10.0.0.9\n",
        });
        expect(resolveSshTarget("nas", { sshDir: dir, localUser: "me" })).toMatchObject({ hostName: "10.0.0.2", user: "from-include", port: 2022 });
    });

    test("a file that includes itself, a bad port or an unknown token is an error that names it", () => {
        expect(() => resolveSshTarget("x", { sshDir: sshDir("Include config\n"), localUser: "me" })).toThrow("Include goes deeper");
        expect(() => resolveSshTarget("x", { sshDir: sshDir("Port twenty\n"), localUser: "me" })).toThrow('Port "twenty"');
        expect(() => resolveSshTarget("x", { sshDir: sshDir("IdentityFile ~/.ssh/%C\n"), localUser: "me" })).toThrow("%C");
    });
});
