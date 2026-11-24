// Report an Issue's diagnostics leave the computer, so nothing that names the
// person, the computer or a network, or holds a secret, may be in them; and
// what's left is the part of the log that helps: warnings, errors, the end.
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_DETAILS_LENGTH } from "issues/shared";
import { buildDetails, logEntries, readLogTail, scrub, type Scrubber } from "../../src/main/issueDetails";
import { tempDir } from "../platform/app/support/temp";

// a made-up Discord bot token, put together here so secret scanners don't take the source for a real one
const FAKE_BOT_TOKEN = ["MTA5ODc2NTQzMjEwOTg3NjU0", "GaBcDe", "abcdefghijklmnopqrstuvwxyz0123456"].join(".");

const WHO: Scrubber = { home: "/home/alex", username: "alex", computerNames: ["alex-desktop.lan", "Workshop", "10.0.0.5"] };

let dir: string | undefined;
afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

// Inventory: Security — paths, names, addresses, emails and secrets never leave in diagnostics.
test("scrub replaces what identifies the person, the computer or a network, and secrets", () => {
    const leaks = [
        "Loaded /home/alex/.paperboard/panels/x and C:\\Users\\alex\\AppData too",
        "Paperboard Server online: alex-desktop (192.168.88.19:45911) and Workshop at fe80:0:0:0:1c2b:3a4d:5e6f:7081",
        "signed in as alex@example.com",
        "[Discovery] Paperboard Server offline: kitchen-pc (kitchen-pc.local:45464)",
        "GET https://user:hunter2@example.com/x?token=abc123&page=2",
        'config {"apiKey": "sk-ant-abcdefghijklmnop1234", "password":"p4ss word"}',
        "Authorization: Bearer abc.def.ghi",
        `bot ${FAKE_BOT_TOKEN} ready`,
        "jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl",
        "colour \u001b[31mred\u001b[0m bell\u0007",
    ].join("\n");
    const scrubbed = scrub(leaks, { ...WHO, home: "C:\\Users\\alex" });
    const homeScrubbed = scrub(leaks, WHO);
    for (const out of [scrubbed, homeScrubbed]) {
        for (const secret of ["alex", "192.168.88.19", "fe80", "Workshop", "hunter2", "abc123", "sk-ant", "p4ss", "abc.def.ghi", "s word", "MTA5ODc2", "eyJhbGci", "\u001b", "\u0007", "kitchen"]) {
            expect({ secret, found: out.toLowerCase().includes(secret.toLowerCase()) }).toEqual({ secret, found: false });
        }
    }
    expect(homeScrubbed).toContain("Loaded ~/.paperboard/panels/x");
    expect(scrubbed).toContain("and ~\\AppData too");
    expect(homeScrubbed).toContain('"password":"<secret>"}');
    expect(homeScrubbed).toContain("Authorization: <secret>");
    expect(homeScrubbed).toContain("Paperboard Server online: <computer> (<ip>:45911) and <computer> at <ip>");
    expect(homeScrubbed).toContain("signed in as <email>");
    expect(homeScrubbed).toContain("Paperboard Server offline: <computer> (<computer>:45464)");
    expect(homeScrubbed).toContain("https://<secret>@example.com/x?token=<secret>&page=2");
    expect(homeScrubbed).toContain("colour red bell");
    // loopback says nothing about anyone
    expect(scrub("listening on 127.0.0.1:38419", WHO)).toBe("listening on 127.0.0.1:38419");
});

// Inventory: Security — IPv6 addresses go whatever their form, and a timestamp or a sentence's colon isn't mistaken for one.
test("scrub replaces compressed, bracketed and zoned IPv6 addresses", () => {
    const out = scrub(
        [
            "peer 2001:db8:85a3::8a2e:370:7334 up",
            "listening on [2a02:1810:4d02:5c00::1]:45464",
            "link fe80::1c2b:3cff:fe4d:5e6f%en0 down",
            "dialing fe80::1: refused",
            "mapped ::ffff:192.168.1.9 seen",
            "loopback ::1 and [::1]:3000",
        ].join("\n"),
        WHO,
    );
    expect(out).toBe(
        [
            "peer <ip> up",
            "listening on [<ip>]:45464",
            "link <ip> down",
            "dialing <ip>: refused",
            "mapped <ip> seen",
            "loopback ::1 and [::1]:3000",
        ].join("\n"),
    );
    // not addresses
    expect(scrub("2026-11-23T10:00:01.000Z at 10:00:01 ratio 3:2 Foo::bar", WHO)).toContain("2026-11-23T10:00:01.000Z at 10:00:01 ratio 3:2");
});

test("scrub replaces the home folder only where it is the folder", () => {
    const who = { ...WHO, home: "/home/bob", username: "bob" };
    expect(scrub("/home/bob/notes.txt /home/bobby/notes.txt /home/bob. at /home/bob", who)).toBe("~/notes.txt /home/bobby/notes.txt ~. at ~");
});

const line = (time: string, level: string, text: string) => `2026-11-23T${time}.000Z [${level}] [paperboard] ${text}`;

test("the log keeps recent warnings and errors with their stacks, then the latest entries", () => {
    const log = [
        "tail of an entry cut by the read",
        line("10:00:00", "INFO", "[Blocks] Registered 34 blocks"),
        line("10:00:01", "ERROR", "[Supervisor] crashed"),
        "    at restart (/home/alex/app.js:1:1)",
        line("10:00:02", "WARN", "[Updater] slow"),
        ...Array.from({ length: 100 }, (_, i) => line("10:01:00", "INFO", `routine ${i}`)),
    ].join("\n");
    const entries = logEntries(log);
    expect(entries[0]).toBe("2026-11-23T10:00:00.000Z [INFO] [Blocks] Registered 34 blocks");
    const details = buildDetails(
        { computer: { kind: "this", connected: true }, pairedCount: 0, panels: [{ id: "dev.paperboard.terminal", version: "0.4.0" }], log },
        WHO,
    );
    expect(details).toContain("Looking at: this computer, connected\nPaired computers: 0\nPanels on it (1):\n- dev.paperboard.terminal 0.4.0");
    expect(details).toContain(
        "Recent warnings and errors (2, oldest first):\n2026-11-23T10:00:01.000Z [ERROR] [Supervisor] crashed\n    at restart (~/app.js:1:1)\n2026-11-23T10:00:02.000Z [WARN] [Updater] slow",
    );
    expect(details).toContain("Latest log entries (80):");
    expect(details.trimEnd().endsWith("routine 99")).toBe(true);
    expect(details).not.toContain("routine 19\n");
});

test("diagnostics over the service's limit lose their oldest log lines, never the head", () => {
    const log = Array.from({ length: 200 }, (_, i) => line("10:00:00", "ERROR", `${i} ${"x".repeat(1900)}`)).join("\n");
    const details = buildDetails({ computer: { kind: "paired", os: "Windows", osVersion: "11", connected: false }, pairedCount: 1, panels: { error: "not connected" }, log }, WHO);
    expect(details.length).toBeLessThanOrEqual(MAX_DETAILS_LENGTH);
    expect(details.startsWith("Looking at: a paired computer (Windows 11), not connected\nPaired computers: 1\nPanels: couldn't be read: not connected")).toBe(true);
    // both sections stay, headers and newest entries included, and say older ones were cut
    expect(details).toMatch(/Recent warnings and errors \(\d+, oldest first, older cut\):\n.*\n/);
    expect(details).toMatch(/\n\nLatest log entries \(\d+, older cut\):\n/);
    expect(details).toContain("199 xxx");
    expect(details.trimEnd().endsWith("x".repeat(100))).toBe(true);
});

test("the log tail reaches into the rotated file only when the current one is short", () => {
    dir = tempDir("issue-details");
    fs.writeFileSync(path.join(dir, "paperboard.1.log"), `${line("09:00:00", "ERROR", "before rotation")}\n`);
    fs.writeFileSync(path.join(dir, "paperboard.log"), `${line("10:00:00", "INFO", "after rotation")}\n`);
    expect(logEntries(readLogTail(dir))).toEqual([
        "2026-11-23T09:00:00.000Z [ERROR] before rotation",
        "2026-11-23T10:00:00.000Z [INFO] after rotation",
    ]);
    expect(readLogTail(path.join(dir, "missing"))).toBe("");
});
