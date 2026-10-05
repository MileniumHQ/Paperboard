// Blog posts are markdown files. Frontmatter carries the article metadata
// (title, date, image, optional author, summary); the body is rendered by
// PaperMarkdown (PaperUI elements, no innerHTML), which owns the typography.
// Carousels are the one block of our own; blogBlocks.ts owns their syntax.
import { parsePostBlocks, type PostBlock } from "./blogBlocks";

export interface Post {
    slug: string;
    title: string;
    date: string;
    author?: string;
    image: string;
    summary: string;
    body: string;
    blocks: PostBlock[];
    readingMinutes: number;
}

interface Frontmatter {
    data: Record<string, string>;
    body: string;
}

function parseFrontmatter(source: string, file: string): Frontmatter {
    if (!source.startsWith("---")) {
        throw new Error(`paperdocs: ${file} is missing frontmatter`);
    }
    const end = source.indexOf("\n---", 3);
    if (end === -1) {
        throw new Error(`paperdocs: ${file} has unterminated frontmatter`);
    }
    const data: Record<string, string> = {};
    for (const line of source.slice(3, end).trim().split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        data[key] = value;
    }
    return { data, body: source.slice(end + 4).trim() };
}

function required(
    data: Record<string, string>,
    key: string,
    file: string,
): string {
    const value = data[key];
    if (!value) {
        throw new Error(
            `paperdocs: ${file} frontmatter is missing "${key}"`,
        );
    }
    return value;
}

function readingMinutes(body: string): number {
    const words = body
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
}

const sources = import.meta.glob<string>("./blog/*.md", {
    eager: true,
    query: "?raw",
    import: "default",
});

function toPost(path: string, source: string): Post {
    const file = path.split("/").pop() ?? path;
    const { data, body } = parseFrontmatter(source, file);
    return {
        slug: file.replace(/\.md$/, ""),
        title: required(data, "title", file),
        date: required(data, "date", file),
        author: data.author,
        image: required(data, "image", file),
        summary: required(data, "summary", file),
        body,
        blocks: parsePostBlocks(body, file),
        readingMinutes: readingMinutes(body),
    };
}

// Newest first; a blog index reads backwards in time.
export const BLOG_POSTS: Post[] = Object.entries(sources)
    .map(([path, source]) => toPost(path, source))
    .sort((a, b) => b.date.localeCompare(a.date));
