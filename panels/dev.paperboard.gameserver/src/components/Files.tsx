import { PaperFileBrowser, PaperFlex, PaperPageHeader, PaperText, type PaperFileReveal } from "@mileniumhq/paperui";
import { listServerFiles, readServerFile, writeServerFile } from "../lib/files";

// Files: the server folder as a tree with an editor. The Configure button on
// a plugin or mod opens this tab at that add-on's settings via `reveal`.
export default function Files(props: { reveal: PaperFileReveal | null }) {
    return (
        <>
            <PaperPageHeader icon="folder" title="Files">
                <PaperText size={2} color="text-subtle">
                    Most changes apply when the server or the plugin restarts.
                </PaperText>
            </PaperPageHeader>
            <PaperFlex direction="row" flex minHeight={0}>
                <PaperFileBrowser
                    rootLabel="Server"
                    list={listServerFiles}
                    read={readServerFile}
                    write={writeServerFile}
                    reveal={props.reveal}
                />
            </PaperFlex>
        </>
    );
}
