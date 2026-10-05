import { PaperFlex, PaperLink, PaperText } from "@paperboard-dev/paperui";
import { createMemo } from "solid-js";
import { allPagesFor, sectionKeys } from "../utils/routeUtils";
import { docsPath } from "../utils/base";

export function NotFound() {
    // Picked once when the 404 mounts — a random real page, so "Go somewhere"
    // actually goes somewhere. Falls back to the docs root if somehow empty.
    const target = createMemo(() => {
        const pages = sectionKeys.flatMap((section) =>
            allPagesFor(section).map((p) => docsPath(section, p.pageKey)),
        );
        if (pages.length === 0) return "/docs/";
        return pages[Math.floor(Math.random() * pages.length)];
    });

    return (
        <PaperFlex
            fullHeight
            fullWidth
            align="center"
            justify="center"
            direction="column"
            gap="threefourths"
            style={{ "min-height": "calc(100vh - 45px)" }}
        >
            <PaperText weight={900} size={17}>
                404
            </PaperText>
            <PaperText>
                You've wandered far and wide, and gotten nowhere.
            </PaperText>
            <PaperLink href={target()}>Go somewhere</PaperLink>
        </PaperFlex>
    );
}
