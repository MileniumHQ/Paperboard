import { describe, expect, test } from "bun:test";
import { parseServer, parseToolsConfig, secretNames, vaultName } from "../src/service/mcpConfig";

const stdio = (o: Record<string, unknown> = {}) => ({ name: "files", transport: "stdio", command: "npx", args: ["-y", "pkg"], ...o });
const http = (o: Record<string, unknown> = {}) => ({ name: "notes", transport: "http", url: "https://example.com/mcp", ...o });

describe("a stdio server is an argv array", () => {
    test("a valid server, with defaults filled in", () => {
        expect(parseServer(stdio())).toEqual({ name: "files", where: "host", transport: "stdio", command: "npx", args: ["-y", "pkg"], env: {}, enabled: true });
        expect(parseServer(stdio({ where: "computer" })).where).toBe("computer");
    });

    test("a command line in the command field is refused: arguments have their own list", () => {
        expect(() => parseServer(stdio({ command: "npx -y pkg" }))).toThrow(/arguments/);
        expect(() => parseServer(stdio({ command: "a\nb" }))).toThrow(/one program/);
        expect(() => parseServer(stdio({ command: "--version" }))).toThrow(/dash/);
        // an absolute path may hold a space
        expect(parseServer(stdio({ command: "/opt/my tools/server" })).transport).toBe("stdio");
    });

    test("arguments are bounded text", () => {
        expect(() => parseServer(stdio({ args: "-y pkg" }))).toThrow(/list/);
        expect(() => parseServer(stdio({ args: Array(33).fill("a") }))).toThrow(/at most 32/);
        expect(() => parseServer(stdio({ args: [1] }))).toThrow(/text/);
        expect(() => parseServer(stdio({ args: ["a\0b"] }))).toThrow(/NUL/);
        expect(() => parseServer(stdio({ args: ["x".repeat(5000)] }))).toThrow(/limited/);
    });

    test("names are plain and not reserved; unknown settings are refused, not ignored", () => {
        expect(() => parseServer(stdio({ name: "Files" }))).toThrow(/lowercase/);
        expect(() => parseServer(stdio({ name: "a__b" }))).toThrow(/lowercase/);
        expect(() => parseServer(stdio({ name: "mcp" }))).toThrow(/reserved/);
        expect(() => parseServer(stdio({ shell: true }))).toThrow(/isn't a setting/);
        expect(() => parseServer(stdio({ where: "cloud" }))).toThrow(/where/);
    });
});

describe("secrets never live in the config", () => {
    test("a secret is referenced by name", () => {
        const s = parseServer(stdio({ env: { GITHUB_TOKEN: { secret: "github" }, MODE: "fast" } }));
        expect(s.transport === "stdio" && s.env).toEqual({ GITHUB_TOKEN: { secret: "github" }, MODE: "fast" });
        expect(secretNames(s)).toEqual(["github"]);
        expect(vaultName("files", "github")).toBe("mcp.files.github");
    });

    test("a token written into the environment is refused", () => {
        expect(() => parseServer(stdio({ env: { API_KEY: "abc123" } }))).toThrow(/vault/);
        expect(() => parseServer(stdio({ env: { WHATEVER: "ghp_abcdef" } }))).toThrow(/vault/);
        expect(() => parseServer(stdio({ env: { PAPERCRANE_TOKEN: "x" } }))).toThrow(/reserved/);
        expect(() => parseServer(stdio({ env: { "BAD NAME": "x" } }))).toThrow(/variable name/);
    });

    test("an Authorization header, a password in the address or a key in the query is refused", () => {
        expect(() => parseServer(http({ headers: { Authorization: "Bearer abc" } }))).toThrow(/vault/);
        expect(() => parseServer(http({ headers: { "X-Thing": "Bearer abc" } }))).toThrow(/vault/);
        expect(() => parseServer(http({ url: "https://user:pw@example.com/mcp" }))).toThrow(/password/);
        expect(() => parseServer(http({ url: "https://example.com/mcp?api_key=1" }))).toThrow(/plaintext/);
        expect(parseServer(http({ headers: { Authorization: { secret: "notes-key" } } })).transport).toBe("http");
        expect(parseServer(http({ headers: { "X-Region": "eu" } })).transport).toBe("http");
    });

    test("a secret's name is plain", () => {
        expect(() => parseServer(stdio({ env: { K: { secret: "a b" } } }))).toThrow(/secret/);
        expect(() => parseServer(stdio({ env: { K: { secret: "a", value: "x" } } }))).toThrow(/isn't a setting/);
    });
});

describe("http servers", () => {
    test("only http(s), and only from this computer", () => {
        expect(() => parseServer(http({ url: "ftp://x" }))).toThrow(/http/);
        expect(() => parseServer(http({ url: "nope" }))).toThrow(/URL/);
        expect(() => parseServer(http({ where: "computer" }))).toThrow(/this computer/);
        expect(() => parseServer(http({ headers: { "Content-Type": "x" } }))).toThrow(/set by the connection/);
    });
});

describe("tools.json as a whole", () => {
    test("absent is the default; malformed is an error, never the default", () => {
        expect(parseToolsConfig(null)).toEqual({ actions: true, servers: [] });
        expect(parseToolsConfig({})).toEqual({ actions: true, servers: [] });
        expect(() => parseToolsConfig("garbage")).toThrow();
        expect(() => parseToolsConfig({ actions: "yes" })).toThrow(/actions/);
        expect(() => parseToolsConfig({ servers: [stdio(), stdio()] })).toThrow(/two servers/);
        expect(() => parseToolsConfig({ servers: "x" })).toThrow(/list/);
    });

    test("the number of servers and of those switched on is bounded", () => {
        const many = (n: number, enabled: boolean) => Array.from({ length: n }, (_, i) => stdio({ name: `s${String.fromCharCode(97 + i)}`, enabled }));
        expect(parseToolsConfig({ servers: many(16, false) }).servers).toHaveLength(16);
        expect(() => parseToolsConfig({ servers: many(17, false) })).toThrow(/at most 16/);
        expect(() => parseToolsConfig({ servers: many(9, true) })).toThrow(/at most 8/);
    });
});
