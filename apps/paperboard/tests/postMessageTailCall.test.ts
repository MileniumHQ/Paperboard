// cross-frame messages keep their sender in WebKit (bun test): no
// postMessage may be a tail call.
//
// WebKit sets a message's event.source to the window of the function that
// called postMessage. JavaScriptCore is the one engine with proper tail
// calls, so in strict code (every module) `() => frame.contentWindow.postMessage(…)`
// leaves no caller frame behind, and Safari reports the *receiving* window as
// the source. The shell and PaperAPI drop messages whose source isn't the
// frame or parent they expect: in Paperboard web on Safari and iOS, every
// panel stayed on "Connecting panel…" because its readiness challenge was
// dropped. Chromium has no tail calls, so the desktop app never shows it.
//
// Write the call as a statement instead: `() => { w.postMessage(…); }`.
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dir, "../../..");
// everything that runs in a shell, panel or library document
const SOURCE_ROOTS = [
    "apps/paperboard/src",
    "apps/origami/library/src",
    ...fs.readdirSync(path.join(ROOT, "packages")).map((name) => `packages/${name}/src`),
    ...fs.readdirSync(path.join(ROOT, "panels")).map((name) => `panels/${name}/src`),
].filter((dir) => fs.existsSync(path.join(ROOT, dir)));

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter((file) => !file.split(path.sep).includes("node_modules"));
}

// whether `node`'s value is what its function returns, the way a call there
// becomes a tail call
function inTailPosition(node: ts.Node): boolean {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (ts.isReturnStatement(parent)) return true;
        if (ts.isArrowFunction(parent)) return parent.body === child;
        if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent)) continue;
        if (ts.isConditionalExpression(parent) && child !== parent.condition) continue;
        if (ts.isBinaryExpression(parent) && child === parent.right) {
            const op = parent.operatorToken.kind;
            if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.CommaToken) continue;
        }
        return false;
    }
    return false;
}

function tailPostMessages(file: string, text: string): string[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "postMessage" && inTailPosition(node)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            found.push(`${path.relative(ROOT, file)}:${line + 1}`);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

describe("postMessage tail calls", () => {
    it("finds a tail-position postMessage however it is written", () => {
        const cases = [
            "const a = () => w.postMessage(m, '*');",
            "const b = () => frame?.contentWindow?.postMessage(m, '*');",
            "const c = () => ready && w.postMessage(m, '*');",
            "const d = () => (ok ? w.postMessage(m, '*') : undefined);",
            "function e() { return w.postMessage(m, '*'); }",
            "p.then((r) => w.postMessage(r, '*'));",
        ];
        for (const code of cases) expect(tailPostMessages("case.ts", code)).toHaveLength(1);
        const statements = [
            "const a = () => { w.postMessage(m, '*'); };",
            "const b = () => { if (ready) frame?.contentWindow?.postMessage(m, '*'); };",
            "function c() { w.postMessage(m, '*'); }",
            "const d = () => void w.postMessage(m, '*');",
        ];
        for (const code of statements) expect(tailPostMessages("case.ts", code)).toHaveLength(0);
    });

    it("has none in the shell, PaperAPI, PaperUI, the panel library or any panel", () => {
        const files = SOURCE_ROOTS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
        expect(files.length).toBeGreaterThan(100);
        const found = files.flatMap((file) => tailPostMessages(file, fs.readFileSync(file, "utf8")));
        expect(found).toEqual([]);
    });
});
