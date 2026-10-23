import { describe, expect, test } from "bun:test";
import { blankForm, formFromSpec, newRow, secretNameOf, specFromForm, typedSecrets } from "../src/tools/form";
import { parseServer } from "../src/service/mcpConfig";

describe("the server editor's form", () => {
    test("a program with arguments and a secret becomes a spec the service accepts, and back", () => {
        const f = { ...blankForm(), name: " github ", command: " npx ", args: "-y\n@scope/pkg\n\n--flag=a b\n", rows: [newRow({ name: "MODE", value: "fast" }), newRow({ name: "GITHUB_TOKEN", kind: "secret", typed: "ghp_x" })] };
        const spec = specFromForm(f);
        expect(spec).toEqual({
            name: "github",
            where: "host",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@scope/pkg", "--flag=a b"],
            env: { MODE: "fast", GITHUB_TOKEN: { secret: "github_token" } },
            enabled: true,
        });
        expect(parseServer(spec)).toEqual(spec);
        // the typed secret value is in the form only, never in the spec
        expect(JSON.stringify(spec)).not.toContain("ghp_x");
        expect(typedSecrets(f)).toEqual([{ name: "github_token", value: "ghp_x" }]);
        const back = formFromSpec(spec);
        expect(back.editing).toBe(true);
        expect(back.args).toBe("-y\n@scope/pkg\n--flag=a b");
        expect(back.rows.map((r) => [r.name, r.kind, r.typed])).toEqual([["MODE", "value", ""], ["GITHUB_TOKEN", "secret", ""]]);
        // editing without retyping a saved secret sends no secret
        expect(typedSecrets(back)).toEqual([]);
    });

    test("a web address keeps headers and is always from this computer", () => {
        const f = { ...blankForm(), name: "notes", transport: "http" as const, url: " https://x.test/mcp ", rows: [newRow({ name: "Authorization", kind: "secret", typed: "Bearer z" })] };
        const spec = specFromForm(f);
        expect(spec).toMatchObject({ transport: "http", where: "host", url: "https://x.test/mcp", headers: { Authorization: { secret: "authorization" } } });
        expect(parseServer(spec)).toEqual(spec);
    });

    test("a server saved for the old VM computer is saved to run on this computer, and the form says so first", () => {
        const f = formFromSpec({ name: "inside", where: "computer", transport: "stdio", command: "npx", args: ["pkg"], env: {}, enabled: true });
        expect(f.wasInsideComputer).toBe(true);
        expect(specFromForm(f).where).toBe("host");
    });

    test("secret names are plain", () => {
        expect(secretNameOf("X-Api Key!")).toBe("x-api-key");
    });
});
