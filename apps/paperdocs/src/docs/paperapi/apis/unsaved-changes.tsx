import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function UnsavedChangesApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">setUnsavedChanges</PaperText>
            <PaperText preset="body" as="p">
                setUnsavedChanges tells Paperboard that a panel page holds work the person hasn't saved, such as an edited file.
                While it does, Paperboard keeps the page loaded, and asks the page before it takes it away.
                It works only on a panel page. A widget calling it throws.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { setUnsavedChanges } from "@mileniumhq/paperapi";
import { PaperFileBrowser, type PaperFileBrowserRef } from "@mileniumhq/paperui";

let browser: PaperFileBrowserRef | undefined;
createEffect(on(() => browser?.dirty(), (dirty) => setUnsavedChanges(dirty ? browser!.confirmLeave : null)));

<PaperFileBrowser ref={(ref) => (browser = ref)} /* ... */ />`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Pass the function that asks the person what happens to their work while there is some, and <PaperCode>null</PaperCode> once there is none.
                The function shows the panel's own dialog (save, discard or stay) and resolves <PaperCode>true</PaperCode> when the page may go, <PaperCode>false</PaperCode> to stay.
                PaperFileBrowser's <PaperCode>confirmLeave</PaperCode> fits as it is.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`setUnsavedChanges(confirmLeave: (() => Promise<boolean>) | null): void;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>When Paperboard would</th>
                        <th>What happens while the page has unsaved work</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Unload a page left out of view, or one past the open-panel limit</td>
                        <td>The page stays loaded.</td>
                    </tr>
                    <tr>
                        <td>Restart the panel, uninstall it, or forget its computer</td>
                        <td>Paperboard shows the page and calls <PaperCode>confirmLeave</PaperCode>. It goes ahead only on <PaperCode>true</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>A <PaperCode>confirmLeave</PaperCode> that throws or rejects keeps the page, and Paperboard shows the error.</li>
                <li>Quitting Paperboard does not ask yet. Save often enough that quitting loses little.</li>
                <li>Calling it before Paperboard has opened the page is fine: Paperboard is told as soon as it does.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
