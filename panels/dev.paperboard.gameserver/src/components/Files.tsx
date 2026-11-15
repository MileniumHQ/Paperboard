import { PaperFileBrowser, PaperFlex, PaperPageHeader, PaperText, type PaperFileReveal } from "@mileniumhq/paperui";
import { useServer } from "../lib/server";

// Files: the server folder as a tree with an editor. The Configure button on
// a plugin or mod opens this tab at that add-on's settings via `reveal`.
// Leaving the tab with unsaved edits asks first: `guardLeaving` takes the
// browser's question for every way out of the tab.
export default function Files(props: { reveal: PaperFileReveal | null; guardLeaving: (confirmLeave: () => Promise<boolean>) => void }) {
    // the service owns every path check and size cap; these only carry the request
    const { calls } = useServer();
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
                    list={(path) => calls.listServerFiles({ path })}
                    read={(path) => calls.readServerFile({ path })}
                    write={(path, text, version) => calls.writeServerFile({ path, text, version })}
                    reveal={props.reveal}
                    ref={(browser) => props.guardLeaving(browser.confirmLeave)}
                />
            </PaperFlex>
        </>
    );
}
