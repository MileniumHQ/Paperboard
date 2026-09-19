import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import type { Plugin } from "vite";
import type { SearchRecord } from "./src/types/docs";

// Compile-time docs search index. The docs pages are TSX built from PaperText
// blocks, so the index is extracted from the source AST instead of shipping
// the raw pages to the browser. One record per page.

const VIRTUAL_ID = "virtual:docs-search";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

interface PageRef {
    sectionKey: string;
    sectionName: string;
    subKey: string;
    subName: string;
    pageKey: string;
    pageName: string;
}

function listTsx(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listTsx(full));
        } else if (entry.name.endsWith(".tsx")) {
            out.push(full);
        }
    }
    return out;
}

function stringAttr(
    node: ts.JsxOpeningElement,
    name: string,
): string | undefined {
    for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText() === name) {
            const init = prop.initializer;
            if (init && ts.isStringLiteral(init)) return init.text;
            return "";
        }
    }
    return undefined;
}

function collectText(node: ts.Node, out: string[]): void {
    if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (text) out.push(text);
        return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (text) out.push(text);
        return;
    }
    if (ts.isTemplateExpression(node)) {
        const parts = [
            node.head.text,
            ...node.templateSpans.map((span) => span.literal.text),
        ];
        const text = parts.join(" ").replace(/\s+/g, " ").trim();
        if (text) out.push(text);
        return;
    }
    ts.forEachChild(node, (child) => collectText(child, out));
}

function extractPage(
    source: string,
    fileName: string,
): { title: string; headings: string[]; body: string } {
    const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );

    let title = "";
    const headings: string[] = [];
    const bodyParts: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isJsxElement(node) &&
            node.openingElement.tagName.getText() === "PaperText"
        ) {
            const preset = stringAttr(node.openingElement, "preset");
            const parts: string[] = [];
            for (const child of node.children) collectText(child, parts);
            const text = parts.join(" ").replace(/\s+/g, " ").trim();
            if (text) {
                if (preset === "header") {
                    if (!title) title = text;
                } else if (preset === "subheader") {
                    headings.push(text);
                } else {
                    bodyParts.push(text);
                }
            }
            return;
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { title, headings, body: bodyParts.join(" ") };
}

function buildIndex(root: string): SearchRecord[] {
    const docsRoot = join(root, "src", "docs");
    const index = JSON.parse(
        readFileSync(join(docsRoot, "index.json"), "utf8"),
    ) as Record<string, any>;

    const refs = new Map<string, PageRef>();
    for (const [sectionKey, sectionData] of Object.entries(index)) {
        if (sectionKey === "meta") continue;
        const sectionName =
            index.meta?.sections?.[sectionKey]?.name ?? sectionKey;
        for (const [subKey, sub] of Object.entries<any>(
            sectionData.subsections ?? {},
        )) {
            for (const [pageKey, page] of Object.entries<any>(
                sub.pages ?? {},
            )) {
                const file = page.file ?? pageKey;
                refs.set(`${sectionKey}/${subKey}/${file}.tsx`, {
                    sectionKey,
                    sectionName,
                    subKey,
                    subName: sub.name ?? subKey,
                    pageKey,
                    pageName: page.name ?? pageKey,
                });
            }
        }
    }

    const records: SearchRecord[] = [];
    for (const file of listTsx(docsRoot)) {
        const rel = file.slice(docsRoot.length + 1).split("\\").join("/");
        const ref = refs.get(rel);
        if (!ref) continue;
        const { title, headings, body } = extractPage(
            readFileSync(file, "utf8"),
            file,
        );
        records.push({
            section: ref.sectionKey,
            sectionName: ref.sectionName,
            subsection: ref.subKey,
            subsectionName: ref.subName,
            page: ref.pageKey,
            pageName: ref.pageName,
            title: title || ref.pageName,
            headings,
            body: body.slice(0, 2000),
            url: `${ref.sectionKey}/${ref.pageKey}`,
        });
    }
    return records;
}

export function docsSearchPlugin(): Plugin {
    let root = process.cwd();
    let cache: SearchRecord[] | null = null;

    return {
        name: "paperdocs-search-index",
        configResolved(config) {
            root = config.root;
        },
        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_ID;
        },
        load(id) {
            if (id !== RESOLVED_ID) return;
            if (!cache) cache = buildIndex(root);
            return `export default ${JSON.stringify(cache)};`;
        },
        handleHotUpdate({ file, server }) {
            const docsSegment = join("src", "docs");
            if (!file.includes(docsSegment)) return;
            cache = null;
            const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
            if (mod) {
                server.moduleGraph.invalidateModule(mod);
                return [mod];
            }
        },
    };
}
