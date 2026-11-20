import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// JSX drops whitespace that contains a line break. In prose, a line that ends
// a sentence and a next line that starts with an element render with no
// space between them ("installer.npx"). This check finds every place in the
// site's JSX where a line break is the only space between text and an element
// or expression, so the build fails before the page or its .md export ships.
//
// Only prose is checked: an element whose own text has a sentence (a `.`, `!`,
// `?` or `:` before a space or the end). A button's icon on one line and its
// label on the next has no sentence, and its layout spaces the two itself.
// A hit is fixed with `{" "}` at the end of the line.
//
// Not a hit: text that ends with an opening bracket or quote before the break,
// text that starts with closing punctuation after it ("</PaperLink>\n."), and
// a break next to a `{" "}` that already holds the space.

const PROSE = /[.!?:](\s|$)/;
const OPENS = /[(\[“‘]$/;
const CLOSES = /^[.,;:!?)\]”’…]/;

const spaceLiteral = (node, side) =>
    node !== undefined &&
    ts.isJsxExpression(node) &&
    node.expression !== undefined &&
    ts.isStringLiteralLike(node.expression) &&
    (side === "end" ? /\s$/ : /^\s/).test(node.expression.text);

/** Every place in one source file where a line break is the only space between prose and an element. */
export function proseSpacingHits(file, source) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const hits = [];
    // The two sides of a join as they read in the source, cut short.
    const start = (node) => (ts.isJsxText(node) ? node.text.trimStart() : node.getText(sf)).split("\n")[0].trim().slice(0, 30);
    const end = (node) => (ts.isJsxText(node) ? node.text.trimEnd() : node.getText(sf)).split("\n").pop().trim().slice(-30);
    // The line the break ends, which is the line that takes the `{" "}`.
    const lastLine = (node) => lineOf(ts.isJsxText(node) ? node.pos + node.text.trimEnd().length : node.end);
    const hit = (left, right) => hits.push({ file, line: lastLine(left), left: end(left), right: start(right) });
    const visit = (node) => {
        if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
            const kids = node.children;
            if (kids.some((kid) => ts.isJsxText(kid) && PROSE.test(kid.text))) {
                kids.forEach((kid, i) => {
                    if (!ts.isJsxText(kid)) return;
                    const before = kids[i - 1];
                    const after = kids[i + 1];
                    const text = kid.text;
                    if (!text.trim()) {
                        if (before && after && text.includes("\n") && !spaceLiteral(before, "end") && !spaceLiteral(after, "start")) {
                            hit(before, after);
                        }
                        return;
                    }
                    const tail = text.trimEnd();
                    if (after && /\n/.test(text.slice(tail.length)) && !OPENS.test(tail) && !spaceLiteral(after, "start")) {
                        hit(kid, after);
                    }
                    const head = text.trimStart();
                    if (before && /\n/.test(text.slice(0, text.length - head.length)) && !CLOSES.test(head) && !spaceLiteral(before, "end")) {
                        hit(before, kid);
                    }
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return hits.sort((a, b) => a.line - b.line);
}

/** The hits in every .tsx file under the given directories. */
export function checkProseSpacing(dirs) {
    const hits = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".tsx")) hits.push(...proseSpacingHits(path, readFileSync(path, "utf8")));
        }
    };
    for (const dir of dirs) walk(dir);
    return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const hits = checkProseSpacing([join(root, "src")]);
    for (const hit of hits) {
        console.error(`${relative(root, hit.file)}:${hit.line}: "${hit.left}" and "${hit.right}" run together: JSX drops a line break, so end the line with {" "}`);
    }
    if (hits.length) process.exit(1);
}
