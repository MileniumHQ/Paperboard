// A post body is markdown plus one block of our own: a carousel, fenced by
// `:::carousel` and `:::` lines, holding one image per line. The image title
// is the slide's caption, the same `"Caption"` a lone image uses as a figure:
//
//     :::carousel
//     ![Game Server panel](/screens/gameserver.png "Host a Minecraft server.")
//     ![Bot Creator panel](/screens/botcreator.png "Build a Discord bot.")
//     :::
//
// A malformed carousel fails the build with the file and line, rather than
// shipping its source as text.
export interface Slide {
    src: string;
    alt: string;
    caption: string;
}

export type PostBlock =
    | { kind: "markdown"; text: string }
    | { kind: "carousel"; slides: Slide[] };

const OPEN = ":::carousel";
const CLOSE = ":::";
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SLIDE = /^!\[([^\]]+)\]\((\S+)\s+"([^"]+)"\)$/;

// site-relative or https only; post images are served by the site itself
function slideSrc(raw: string): string | null {
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    if (raw.startsWith("https://")) return raw;
    return null;
}

export function parsePostBlocks(body: string, file: string): PostBlock[] {
    const blocks: PostBlock[] = [];
    const lines = body.split("\n");
    let markdown: string[] = [];
    let fence: string | null = null;

    const flushMarkdown = () => {
        const text = markdown.join("\n").trim();
        if (text) blocks.push({ kind: "markdown", text });
        markdown = [];
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        // carousel markers inside a code fence are code, not blocks
        const fenceMatch = FENCE.exec(line);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (fence === null) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length)
                fence = null;
        }
        if (fence !== null || fenceMatch || line.trim() !== OPEN) {
            markdown.push(line);
            continue;
        }

        const opened = index + 1;
        const slides: Slide[] = [];
        let closed = false;
        for (index++; index < lines.length; index++) {
            const slideLine = lines[index].trim();
            if (slideLine === CLOSE) {
                closed = true;
                break;
            }
            if (!slideLine) continue;
            const match = SLIDE.exec(slideLine);
            const src = match ? slideSrc(match[2]) : null;
            if (!match || !src) {
                throw new Error(
                    `paperdocs: ${file}:${index + 1} carousel lines must be ![alt](/image.png "Caption") with a site or https image`,
                );
            }
            slides.push({ alt: match[1], src, caption: match[3] });
        }
        if (!closed) {
            throw new Error(
                `paperdocs: ${file}:${opened} carousel is missing its closing ${CLOSE}`,
            );
        }
        if (slides.length < 2) {
            throw new Error(
                `paperdocs: ${file}:${opened} a carousel needs at least two slides; use a captioned image for one`,
            );
        }
        flushMarkdown();
        blocks.push({ kind: "carousel", slides });
    }
    flushMarkdown();
    return blocks;
}
