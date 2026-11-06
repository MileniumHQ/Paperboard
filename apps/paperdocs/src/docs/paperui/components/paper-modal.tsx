import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperModal,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperModalDoc() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperModal</PaperText>
            <PaperText preset="body" as="p">
                PaperModal is a dialog over the page, with an optional title, a footer for its buttons, and focus handling built in.
                Use it for a confirmation, a short form, or a task that must finish before the user goes on.
                For a notice that stays in the page, use <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                A modal is always mounted and driven by <PaperCode>open</PaperCode>. Never put it inside a <PaperCode>Show</PaperCode>.
                Keep a boolean signal, set it from the trigger, and clear it in <PaperCode>onClose</PaperCode>.
                Pass the footer's buttons bare, as siblings in <PaperCode>footer</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton onClick={() => setOpen(true)}>Open modal</PaperButton>
                <PaperModal
                    open={open()}
                    onClose={() => setOpen(false)}
                    title="Modal"
                    footer={
                        <>
                            <PaperButton onClick={() => setOpen(false)}>Cancel</PaperButton>
                            <PaperButton variant="primary" onClick={() => setOpen(false)}>Confirm</PaperButton>
                        </>
                    }
                >
                    <PaperText preset="body" as="p">The content of the modal.</PaperText>
                </PaperModal>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperModal, PaperText } from "@mileniumhq/paperui";

export function Example() {
    const [open, setOpen] = createSignal(false);

    return (
        <>
            <PaperButton onClick={() => setOpen(true)}>Open modal</PaperButton>
            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Modal"
                footer={
                    <>
                        <PaperButton onClick={() => setOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" onClick={() => setOpen(false)}>Confirm</PaperButton>
                    </>
                }
            >
                <PaperText preset="body" as="p">The content of the modal.</PaperText>
            </PaperModal>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperModalProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the dialog box, after its <PaperCode>role="dialog"</PaperCode>, so you can override those attributes. Children are the body.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (closed)</td>
                        <td>Shows the modal. The modal animates in and out, and a closed modal renders nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the modal asks to close: the close button, the backdrop, Escape, or the system Back action. Set <PaperCode>open</PaperCode> to <PaperCode>false</PaperCode> in it, or the modal stays open. Without it the modal shows no close button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>The header text. It also names the dialog for assistive technology.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>"small" | "medium" | "large" | "full"</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td>The widest the dialog gets: 420, 600, 760, or 920 pixels. On phones every size takes the screen's width short of a thin rim.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullscreen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Fills the whole viewport with no border or radius. It wins over <PaperCode>size</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placement</PaperCode></td>
                        <td><PaperCode>"center" | "bottom"</PaperCode></td>
                        <td><PaperCode>"center"</PaperCode></td>
                        <td><PaperCode>"bottom"</PaperCode> rises from the screen's bottom edge as a sheet. On phones the sheet has square bottom corners and no gap below.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>footer</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (no footer)</td>
                        <td>A row below the body, right-aligned, with a divider. Pass the buttons bare. On phones they wrap.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>noHeader</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Drops the header and its title. A close button given by <PaperCode>onClose</PaperCode> floats in the top corner.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>noPadding</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Removes the body's padding and gap, for content that fills the dialog.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnBackdropClick</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>A click on the dimmed area outside the dialog calls <PaperCode>onClose</PaperCode>. Set <PaperCode>false</PaperCode> for a modal that holds an unfinished task.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnEsc</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Escape and the system Back action call <PaperCode>onClose</PaperCode>. Set <PaperCode>false</PaperCode> to turn both off.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>concealed</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Keeps the modal open and mounted but invisible, with no pointer input, no Escape, and hidden from assistive technology. Use it while the thing the user picked up inside the modal is carried elsewhere on screen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the dialog box.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="mounting">Mounting and closing</PaperText>
            <PaperTextList>
                <li>The modal is drawn in a portal on the page, above everything else, so a clipping parent cannot cut it off.</li>
                <li>Keep it rendered and toggle <PaperCode>open</PaperCode>. A <PaperCode>Show</PaperCode> around the modal removes it the moment it closes, so the exit animation never plays and the dialog gets no frame to release the page for assistive technology before it leaves.</li>
                <li>A closing dialog drops <PaperCode>aria-modal</PaperCode> at once and leaves the page a frame later, after its exit animation.</li>
                <li>A modal taller than the screen scrolls inside its body, up to 85% of the viewport height. On phones it may use the full screen height.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="focus">Focus</PaperText>
            <PaperTextList>
                <li>On every open, focus moves to the first element inside with the <PaperCode>autofocus</PaperCode> attribute, or to the dialog itself. A field's own autofocus only fires once, at mount, so the modal moves focus again each time.</li>
                <li>Tab and Shift+Tab stay inside the dialog. Disabled, hidden, and inert controls are skipped.</li>
                <li>On close, focus returns to the element that had it when the modal opened.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="stacking">Stacked modals</PaperText>
            <PaperText preset="body" as="p">
                Only the newest open modal answers Escape, the Tab loop, and the system Back action.
                Closing it hands those back to the one beneath.
            </PaperText>
            <PaperText preset="body" as="p">
                The page is dimmed once however many are open. A modal opened over another brings no scrim of its own,
                and the one beneath steps back out of sight and takes no presses until it is on top again. Use this for
                a second step that Back returns from, such as naming what was just picked.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li>The dialog box has <PaperCode>role="dialog"</PaperCode> and <PaperCode>aria-modal="true"</PaperCode> while open.</li>
                <li>With a <PaperCode>title</PaperCode> and a header, <PaperCode>aria-labelledby</PaperCode> points at the title. With <PaperCode>noHeader</PaperCode>, set <PaperCode>aria-label</PaperCode> yourself.</li>
                <li>The close button is named "Close modal".</li>
                <li>A concealed modal is <PaperCode>aria-hidden</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="header">Header rules</PaperText>
            <PaperTextList>
                <li>The header renders when <PaperCode>noHeader</PaperCode> is off and there is a <PaperCode>title</PaperCode> or an <PaperCode>onClose</PaperCode>. A modal with neither has no header.</li>
                <li>A failure that happens inside the modal belongs in its body, as a <PaperCode>PaperQuote</PaperCode> beside the control that failed. Keep the modal open so the user can retry.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="confirm">Confirm a destructive action</PaperText>
            <PaperText preset="body" as="p">
                Run the action in a handler, show a failure in the body, and close only on success.
                The gameserver panel confirms deleting a backup this way.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperButton, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";

export function DeleteConfirm(props: {
    open: boolean;
    onClose: () => void;
    remove: () => Promise<void>;
}) {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");

    async function confirm() {
        setBusy(true);
        setError("");
        try {
            await props.remove();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return;
        } finally {
            setBusy(false);
        }
        props.onClose();
    }

    return (
        <PaperModal
            open={props.open}
            onClose={() => !busy() && props.onClose()}
            title="Delete backup"
            size="small"
            footer={
                <>
                    <PaperButton disabled={busy()} onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="danger" disabled={busy()} onClick={() => void confirm()}>Delete</PaperButton>
                </>
            }
        >
            <PaperText preset="body" as="p">This backup is removed for good.</PaperText>
            <Show when={error()}>
                <PaperQuote variant="danger" title="Not deleted">{error()}</PaperQuote>
            </Show>
        </PaperModal>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="locked">A modal that cannot be dismissed</PaperText>
            <PaperText preset="body" as="p">
                For a task that must finish, turn off every way out and show the close control only when the task stops.
                The gameserver panel's install window has no header, backdrop close, or Escape, and gains a Dismiss button on failure.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperLoader, PaperModal } from "@mileniumhq/paperui";

export function Installing(props: { open: boolean; failed: boolean; onDismiss: () => void }) {
    return (
        <PaperModal
            open={props.open}
            size="small"
            noHeader
            closeOnBackdropClick={false}
            closeOnEsc={false}
            aria-label="Installing"
            footer={props.failed ? <PaperButton onClick={props.onDismiss}>Dismiss</PaperButton> : undefined}
        >
            <PaperLoader loaderStatus={props.failed ? "error" : "indeterminate"} label="Installing" />
        </PaperModal>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="sheet">Bottom sheet</PaperText>
            <PaperCode block language="tsx">
{`<PaperModal open={open()} onClose={() => setOpen(false)} title="Options" placement="bottom" size="small">
    <PaperText preset="body" as="p">Sheet content</PaperText>
</PaperModal>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A message about something that failed or needs attention in the page is <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink>.</li>
                <li>A short list of actions at a point is <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
