#!/usr/bin/env bun
// Backstop for AGENTS.md "Solid:" — catches the mechanical SolidJS mistakes
// a parser can decide on its own, with no type checker, so a whole target
// scans in well under a second. Usage: bun scripts/check-solid.ts <dir>...
// Prints `path:line: <rule>: <why and what to do instead>` per hit and exits
// 1 on any hit, 0 when clean, 2 when the scan could not run.
//
// Scanned: .ts/.tsx under the given dirs, skipping node_modules, dist, out,
// build, release, coverage, dot-dirs and `fixtures` dirs (fixtures are test
// inputs, not product code), and .d.ts files.
//
// "Prop objects" are the identifiers `props`, every name bound by
// `const [a, b] = splitProps(...)` and every name bound to `mergeProps(...)`
// in the same file, and the identifier first parameter of a component
// (below). A "component" is a function whose name (its declaration, or the
// variable it is assigned to) starts with an uppercase letter and that
// returns JSX from its own body (a JSX return, or a JSX arrow body).
//
// Rules:
//  read-jsx-prop-twice
//    Only JSX-valued members count: `children`, or a member whose every
//    property signature in the same file is typed JSX.Element/JSXElement.
//    Reading a string or number twice is harmless, so a member typed
//    elsewhere (an imported props type) or as a plain value is not flagged;
//    on the tree that is how `<Show when={props.error}>{props.error}</Show>`
//    with `error?: string` stays clean.
//    (a) <Show>/<Match> whose `when` is a prop-object member (`props.x`) and
//        whose children render that same member again in JSX child position
//        (`{props.x}`), at any depth, callbacks included. A child position is
//        the only place the second read is known to be rendered: `when` has
//        already evaluated the getter, so a JSX value is built twice. The
//        member passed as an attribute (`<Icon name={props.x} />`) is NOT
//        flagged: attributes are mostly strings/booleans and reading those
//        twice is harmless, and without types that is undecidable.
//    (b) `typeof P.x === "string" ? A : P.x` (also !==, ==, !=, operands in
//        either order): the branch where the value is NOT a string is exactly
//        `P.x` again. Only the "string" test is checked, because string-or-
//        JSX is the shape where the non-string branch is JSX; `typeof
//        local.style === "object" ? local.style : {}` and number/boolean
//        tests are values, not JSX, and are not flagged. The `if (typeof …)
//        return …` statement form is left out: on the tree it only appears in
//        text extraction (PaperCode's getCodeText), never in rendering.
//  destructured-props
//    (a) a component whose first parameter is an object binding pattern.
//    (b) `const { … } = P` where P is a prop object, inside any function in a
//        file that imports solid-js. Both drop reactivity: use splitProps.
//  cleanup-after-await
//    onCleanup called lexically after the first `await` (or `for await`) in an
//    async callback of createEffect/createRenderEffect/createComputed/onMount
//    (also through `on(deps, async …)`), at any depth that does not cross a
//    nested function boundary. After the first await the owner is gone, so
//    it registers nothing and the resource leaks. A nested function defined
//    after the await that calls onCleanup is NOT flagged: whether it runs
//    under the owner (runWithOwner, a later sync caller) is not decidable
//    from syntax.
//
// Deliberately NOT rules:
//  - `<Show … keyed>` whose `when` is a call returning an object from a list
//    lookup (a fresh object each time rebuilds the view). Whether the call
//    returns a stable reference is not mechanically decidable; review judges
//    it.
//  - `const x = props.x` and early returns on props: legitimate in event
//    handlers and untracked helpers, so syntax alone cannot tell the bug.
//  - Functions passed as components without an uppercase name (render
//    props, `component={…}`): which call sites render them as components is
//    not decidable without types.
//
// typescript is resolved from packages/paperui, which depends on it; the root
// package.json does not, and a missing compiler fails the scan (exit 2).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import type * as TS from "typescript";

const ROOT = join(import.meta.dir, "..");
let ts: typeof TS;
try {
    ts = createRequire(join(ROOT, "packages/paperui/package.json"))("typescript");
} catch (err) {
    console.error(`FAIL: could not load typescript from packages/paperui (${String(err)}); run bun install`);
    process.exit(2);
}

const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "release", "coverage", "fixtures"]);
const EFFECTS = new Set(["createEffect", "createRenderEffect", "createComputed", "onMount"]);

export type Hit = { file: string; line: number; rule: string; message: string };

function listFiles(dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        const path = join(dir, name);
        const st = statSync(path);
        if (st.isDirectory()) listFiles(path, out);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
    }
}

const isFunction = (n: TS.Node): n is TS.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessor(n) ||
    ts.isSetAccessor(n) ||
    ts.isConstructorDeclaration(n);

const unwrap = (e: TS.Expression): TS.Expression => {
    let cur = e;
    while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur))
        cur = cur.expression;
    return cur;
};

const isJsx = (e: TS.Node | undefined): boolean => {
    if (!e) return false;
    const u = ts.isExpression(e) ? unwrap(e) : e;
    if (ts.isJsxElement(u) || ts.isJsxSelfClosingElement(u) || ts.isJsxFragment(u)) return true;
    if (ts.isConditionalExpression(u)) return isJsx(u.whenTrue) || isJsx(u.whenFalse);
    if (ts.isBinaryExpression(u)) return isJsx(u.right);
    return false;
};

// Does this function return JSX from its own body (not from nested functions)?
function returnsJsx(fn: TS.FunctionLikeDeclaration): boolean {
    if (!fn.body) return false;
    if (!ts.isBlock(fn.body)) return isJsx(fn.body);
    let found = false;
    const walk = (n: TS.Node): void => {
        if (found || (n !== fn && isFunction(n)) || ts.isClassLike(n)) return;
        if (ts.isReturnStatement(n) && isJsx(n.expression)) {
            found = true;
            return;
        }
        ts.forEachChild(n, walk);
    };
    ts.forEachChild(fn.body, walk);
    return found;
}

function componentName(fn: TS.FunctionLikeDeclaration): string | undefined {
    let name: string | undefined;
    if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) name = fn.name.text;
    if (!name && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        let p: TS.Node = fn.parent;
        while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) p = p.parent;
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) name = p.name.text;
    }
    return name && /^[A-Z]/.test(name) && returnsJsx(fn) ? name : undefined;
}

// `props.x` / `local.x` where the object is a prop object; returns "obj.x".
function propMember(e: TS.Expression | undefined, propObjects: Set<string>): string | undefined {
    if (!e) return undefined;
    const u = unwrap(e);
    if (ts.isPropertyAccessExpression(u) && ts.isIdentifier(u.expression) && propObjects.has(u.expression.text))
        return `${u.expression.text}.${u.name.text}`;
    return undefined;
}

function tagName(n: TS.JsxElement): string {
    return n.openingElement.tagName.getText();
}

export function checkSource(file: string, text: string): Hit[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const hits: Hit[] = [];
    const hit = (node: TS.Node, rule: string, message: string) =>
        hits.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule, message });

    const importsSolid = sf.statements.some(
        (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && /^solid-js(\/|$)/.test(s.moduleSpecifier.text),
    );

    // Pass 1: prop objects.
    const propObjects = new Set<string>(["props"]);
    const collect = (n: TS.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer) {
            const init = unwrap(n.initializer);
            if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
                const callee = init.expression.text;
                if (callee === "splitProps" && ts.isArrayBindingPattern(n.name)) {
                    for (const el of n.name.elements)
                        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) propObjects.add(el.name.text);
                }
                if (callee === "mergeProps" && ts.isIdentifier(n.name)) propObjects.add(n.name.text);
            }
        }
        if (isFunction(n) && componentName(n)) {
            const first = n.parameters[0];
            if (first && ts.isIdentifier(first.name)) propObjects.add(first.name.text);
        }
        ts.forEachChild(n, collect);
    };
    collect(sf);

    // JSX-valued members: `children`, and any member name whose every property
    // signature in this file is typed with JSX.Element/JSXElement.
    const memberTypes = new Map<string, boolean[]>();
    const collectTypes = (n: TS.Node): void => {
        if (ts.isPropertySignature(n) && n.type && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
            const list = memberTypes.get(n.name.text) ?? [];
            list.push(/\bJSX\.Element\b|\bJSXElement\b/.test(n.type.getText(sf)));
            memberTypes.set(n.name.text, list);
        }
        ts.forEachChild(n, collectTypes);
    };
    collectTypes(sf);
    const jsxMember = (member: string): boolean => {
        const name = member.slice(member.indexOf(".") + 1);
        if (name === "children") return true;
        const list = memberTypes.get(name);
        return list !== undefined && list.every(Boolean);
    };

    // Pass 2: rules.
    const visit = (n: TS.Node, inFunction: boolean): void => {
        // read-jsx-prop-twice (a)
        if (ts.isJsxElement(n) && /^(Show|Match)$/.test(tagName(n))) {
            const when = n.openingElement.attributes.properties.find(
                (a): a is TS.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === "when",
            );
            const member =
                when?.initializer && ts.isJsxExpression(when.initializer) ? propMember(when.initializer.expression, propObjects) : undefined;
            if (member && jsxMember(member)) {
                const findChild = (c: TS.Node): void => {
                    if (ts.isJsxExpression(c) && (ts.isJsxElement(c.parent) || ts.isJsxFragment(c.parent))) {
                        if (propMember(c.expression, propObjects) === member) {
                            hit(
                                c,
                                "read-jsx-prop-twice",
                                `<${tagName(n)} when={${member}}> renders ${member} again, so a JSX value is built twice; resolve it once with children(() => ${member}) or use the callback child`,
                            );
                            return;
                        }
                    }
                    ts.forEachChild(c, findChild);
                };
                for (const c of n.children) findChild(c);
            }
        }
        // read-jsx-prop-twice (b)
        if (ts.isConditionalExpression(n)) {
            const cond = unwrap(n.condition);
            if (ts.isBinaryExpression(cond)) {
                const op = cond.operatorToken.kind;
                const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
                const ne = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
                const sides = [unwrap(cond.left), unwrap(cond.right)];
                const typeofSide = sides.find(ts.isTypeOfExpression);
                const stringSide = sides.find((s) => ts.isStringLiteral(s) && s.text === "string");
                if ((eq || ne) && typeofSide && stringSide) {
                    const member = propMember(typeofSide.expression, propObjects);
                    const nonString = eq ? n.whenFalse : n.whenTrue;
                    if (member && jsxMember(member) && propMember(nonString, propObjects) === member) {
                        hit(
                            nonString,
                            "read-jsx-prop-twice",
                            `typeof ${member} reads it, then the non-string branch reads ${member} again, so a JSX value is built twice; resolve it once with children(() => ${member})`,
                        );
                    }
                }
            }
        }
        // destructured-props (a)
        if (isFunction(n)) {
            const name = componentName(n);
            const first = n.parameters[0];
            if (name && first && ts.isObjectBindingPattern(first.name)) {
                hit(first, "destructured-props", `${name} destructures its props, which reads them once and drops reactivity; take props and use splitProps`);
            }
        }
        // destructured-props (b)
        if (
            importsSolid &&
            inFunction &&
            ts.isVariableDeclaration(n) &&
            ts.isObjectBindingPattern(n.name) &&
            n.initializer &&
            ts.isIdentifier(unwrap(n.initializer)) &&
            propObjects.has((unwrap(n.initializer) as TS.Identifier).text)
        ) {
            const obj = (unwrap(n.initializer) as TS.Identifier).text;
            hit(n, "destructured-props", `destructuring ${obj} reads each prop once and drops reactivity; use splitProps or read ${obj}.x where it is used`);
        }
        // cleanup-after-await
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && EFFECTS.has(n.expression.text)) {
            let cb: TS.Expression | undefined = n.arguments[0] && unwrap(n.arguments[0]);
            if (cb && ts.isCallExpression(cb) && ts.isIdentifier(cb.expression) && cb.expression.text === "on")
                cb = cb.arguments[1] && unwrap(cb.arguments[1]);
            if (
                cb &&
                (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
                cb.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
            ) {
                checkCleanupAfterAwait(cb, n.expression.text);
            }
        }
        const nextIn = inFunction || isFunction(n);
        ts.forEachChild(n, (c) => visit(c, nextIn));
    };

    function checkCleanupAfterAwait(fn: TS.ArrowFunction | TS.FunctionExpression, effect: string): void {
        // Own-body nodes only, in source order.
        let firstAwaitEnd = -1;
        const own: TS.Node[] = [];
        const walk = (c: TS.Node): void => {
            if (isFunction(c) || ts.isClassLike(c)) return;
            own.push(c);
            ts.forEachChild(c, walk);
        };
        ts.forEachChild(fn.body, walk);
        if (!ts.isBlock(fn.body)) own.unshift(fn.body);
        for (const c of own) {
            if (ts.isAwaitExpression(c) || (ts.isForOfStatement(c) && c.awaitModifier)) {
                const end = ts.isAwaitExpression(c) ? c.end : (c as TS.ForOfStatement).expression.end;
                if (firstAwaitEnd < 0 || end < firstAwaitEnd) firstAwaitEnd = end;
            }
        }
        if (firstAwaitEnd < 0) return;
        for (const c of own) {
            if (
                ts.isCallExpression(c) &&
                ts.isIdentifier(c.expression) &&
                c.expression.text === "onCleanup" &&
                c.getStart(sf) >= firstAwaitEnd
            ) {
                hit(
                    c,
                    "cleanup-after-await",
                    `onCleanup after an await in an async ${effect} callback registers nothing (the owner is gone); register it before the first await`,
                );
            }
        }
    }

    visit(sf, false);
    return hits;
}

export function checkDirs(dirs: string[]): Hit[] {
    const files: string[] = [];
    for (const d of dirs) listFiles(d, files);
    return files.flatMap((f) => checkSource(f, readFileSync(f, "utf8")));
}

if (import.meta.main) {
    const dirs = process.argv.slice(2);
    if (dirs.length === 0) {
        console.error("usage: bun scripts/check-solid.ts <dir>...");
        process.exit(2);
    }
    for (const d of dirs) {
        try {
            if (!statSync(d).isDirectory()) throw new Error("not a directory");
        } catch (err) {
            console.error(`FAIL: cannot scan ${d}: ${String(err)}`);
            process.exit(2);
        }
    }
    const hits = checkDirs(dirs);
    for (const h of hits) console.log(`${relative(process.cwd(), h.file)}:${h.line}: ${h.rule}: ${h.message}`);
    if (hits.length > 0) {
        console.error(`FAIL: ${hits.length} Solid mistake(s) found above`);
        process.exit(1);
    }
}
