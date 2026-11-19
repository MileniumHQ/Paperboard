import { expect, test } from "bun:test";
import * as path from "node:path";
import ts from "typescript";

// Every answer and push the shell contract declares reaches the renderer,
// which panels' code shares a process with. A secret in one has to be one
// the renderer needs: those are named here, each with its reason at its
// shape in shellContract.ts, and a new one fails this test until it is.
const SECRETS = [
    // the shell's own PaperAPI connection to this computer's daemon
    "call crane-credentials.token",
    // a panel's own sign-in redirect, carrying its code, handed to that panel's frame
    "call panel-loopback-redirect.url",
];
// what a field holding a credential is called
const SECRET_NAME = /token|secret|password|passphrase|cookie|credential|private|cert|apikey|session/i;

const CONTRACT = path.join(import.meta.dir, "../../src/shared/shellContract.ts");
const PROBE = path.join(path.dirname(CONTRACT), "__contractKeys.ts");
const PROBE_SOURCE = `import type { SHELL_CALLS, SHELL_PUSHES, CallAnswer, PushPayload } from "./shellContract";
export type Answers = { [K in keyof typeof SHELL_CALLS]: CallAnswer<K> };
export type Pushes = { [K in keyof typeof SHELL_PUSHES]: PushPayload<K> };
`;

// every field path that crosses, through lists, unions and nullables, once
// each however many of a union's members carry it; an answer typed as any
// JSON could carry anything, so it fails the audit
function fieldPaths(): { paths: string[]; opaque: string[] } {
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const read = host.readFile;
    host.readFile = (file) => (path.resolve(file) === PROBE ? PROBE_SOURCE : read(file));
    const exists = host.fileExists;
    host.fileExists = (file) => path.resolve(file) === PROBE || exists(file);
    const program = ts.createProgram([PROBE], options, host);
    const checker = program.getTypeChecker();
    const probe = checker.getSymbolAtLocation(program.getSourceFile(PROBE)!)!;
    const paths: string[] = [];
    const opaque: string[] = [];
    const walk = (type: ts.Type, at: string, seen: Set<ts.Type>) => {
        if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return void opaque.push(at);
        if (seen.has(type)) return;
        if (type.isUnion() || type.isIntersection()) return type.types.forEach((t) => walk(t, at, seen));
        if (checker.isArrayType(type)) return walk(checker.getTypeArguments(type as ts.TypeReference)[0], at, seen);
        if (!(type.flags & ts.TypeFlags.Object)) return;
        const next = new Set(seen).add(type);
        for (const prop of checker.getPropertiesOfType(type)) {
            const child = `${at}.${prop.name}`;
            if (!paths.includes(child)) paths.push(child);
            walk(checker.getTypeOfSymbol(prop), child, next);
        }
        const index = checker.getIndexInfosOfType(type);
        for (const info of index) walk(info.type, `${at}[]`, next);
    };
    for (const [name, kind] of [["Answers", "call"], ["Pushes", "push"]] as const) {
        const alias = checker.getExportsOfModule(probe).find((s) => s.name === name)!;
        for (const channel of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(alias))) {
            walk(checker.getTypeOfSymbol(channel), `${kind} ${channel.name}`, new Set());
        }
    }
    return { paths, opaque };
}

// Inventory: Security — the renderer is handed no credential it doesn't need.
test("the secrets the shell contract hands the renderer are exactly the ones it needs, and every answer is a shape that can be audited", () => {
    const { paths, opaque } = fieldPaths();
    expect(paths.length).toBeGreaterThan(50);
    expect(opaque).toEqual([]);
    const secrets = paths.filter((p) => SECRETS.includes(p) || SECRET_NAME.test(p.slice(p.lastIndexOf(".") + 1)));
    expect(secrets).toEqual(SECRETS);
}, 60_000);
