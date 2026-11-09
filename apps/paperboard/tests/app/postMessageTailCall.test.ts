import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { REPO_DIR } from "../platform/app/support/build";

// Every postMessage call in tail position: `return x.postMessage(...)`, an
// arrow function whose body is the call, or the call as the last operand
// of a conditional, logical or comma expression in such a position.
function tailPostMessages(fileName: string, source: string): number[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const lines: number[] = [];
    const isPostMessage = (call: ts.CallExpression) => {
        const callee = call.expression;
        if (ts.isPropertyAccessExpression(callee)) return callee.name.text === "postMessage";
        if (ts.isElementAccessExpression(callee)) return ts.isStringLiteral(callee.argumentExpression) && callee.argumentExpression.text === "postMessage";
        return ts.isIdentifier(callee) && callee.text === "postMessage";
    };
    const inTail = (node: ts.Node): boolean => {
        const parent = node.parent;
        if (ts.isReturnStatement(parent)) return parent.expression === node;
        if (ts.isArrowFunction(parent)) return parent.body === node;
        if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) ||
            ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent)) return inTail(parent);
        if (ts.isConditionalExpression(parent)) return parent.condition !== node && inTail(parent);
        if (ts.isBinaryExpression(parent)) {
            const op = parent.operatorToken.kind;
            const shortCircuit = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken ||
                op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.CommaToken;
            return shortCircuit && parent.right === node && inTail(parent);
        }
        return false;
    };
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isPostMessage(node) && inTail(node)) {
            lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return lines;
}

function sources(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sources(full);
        return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
}

const subdirs = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name, "src"));
const ROOTS = [
    path.join(REPO_DIR, "apps", "paperboard", "src"),
    path.join(REPO_DIR, "apps", "origami", "library", "src"),
    ...subdirs(path.join(REPO_DIR, "packages")),
    ...subdirs(path.join(REPO_DIR, "panels")),
];

// No `postMessage` may be a tail call.
describe("postMessage in tail position", () => {
    test("the scan catches every tail shape and leaves the safe ones", () => {
        const bad = [
            "function a(w) { return w.postMessage(1); }",
            "const b = (w) => w.postMessage(1);",
            "const c = (w, ok) => ok && w.postMessage(1);",
            "function d(w, ok) { return ok ? w.postMessage(1) : null; }",
            "const e = (w) => (w.postMessage(1));",
            "function f(w) { return (log(), w['postMessage'](1)); }",
        ];
        for (const snippet of bad) expect({ snippet, found: tailPostMessages("x.ts", snippet).length }).toEqual({ snippet, found: 1 });
        const safe = [
            "function a(w) { w.postMessage(1); }",
            "const b = (w) => { w.postMessage(1); };",
            "const c = (w) => void w.postMessage(1);",
            "async function d(w) { return await w.postMessage(1); }",
            "function e(w) { return w.postMessage(1) ? 1 : 2; }",
        ];
        for (const snippet of safe) expect({ snippet, found: tailPostMessages("x.ts", snippet).length }).toEqual({ snippet, found: 0 });
    });

    test("no shell, PaperAPI, PaperUI, Origami library or panel source calls postMessage in tail position", () => {
        const files = ROOTS.flatMap(sources);
        const callers = files.filter((file) => fs.readFileSync(file, "utf8").includes("postMessage"));
        // the scan read the code that talks across frames
        expect(callers.length).toBeGreaterThan(3);
        const found = callers.flatMap((file) =>
            tailPostMessages(file, fs.readFileSync(file, "utf8")).map((line) => `${path.relative(REPO_DIR, file)}:${line}`));
        expect(found).toEqual([]);
    });
});
