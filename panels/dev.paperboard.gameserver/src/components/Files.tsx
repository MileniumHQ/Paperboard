import { PaperFileBrowser, PaperPage, PaperPageHeader, PaperText, type PaperFileReveal } from "@mileniumhq/paperui";
import { listServerFiles, readServerFile, writeServerFile } from "../lib/files";

// Files: the server folder as a tree with an editor. The Configure button on
// a plugin or mod opens this tab at that add-on's settings via `reveal`.
export default function Files(props: { reveal: PaperFileReveal | null }) {
    return (
        <PaperPage fullWidth fullHeight gap="full">
            <PaperPageHeader icon="folder" title="Files">
                <PaperText size={2} color="text-subtle">
                    Most changes apply when the server or the plugin restarts.
                </PaperText>
            </PaperPageHeader>
            <div style={{ display: "flex", flex: 1, "min-height": 0 }}>
                <PaperFileBrowser
                    rootLabel="Server"
                    list={listServerFiles}
                    read={readServerFile}
                    write={writeServerFile}
                    reveal={props.reveal}
                />
            </div>
        </PaperPage>
    );
}
