import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperModal,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { createSignal } from "solid-js";

export default function PaperModalDoc() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperModal</PaperText>
            <PaperText preset="body">
                PaperModal displays an accessible dialog window over an animated backdrop scrim.
                Reach for PaperModal when requesting confirmations, presenting detail inspectors, or hosting focused workflows.
                The modal manages focus trapping, Escape key dismissal, and portal rendering.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Control visibility through the open prop.
                Listen to dismissal requests via the onClose handler.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperModal, PaperButton, PaperCard, PaperText } from "@mileniumhq/paperui";

export function Example() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperCard padding="double" surface="front">
            <PaperButton variant="primary" onClick={() => setOpen(true)}>
                Open dialog
            </PaperButton>

            <PaperModal
                open={open()}
                title="Confirmation"
                onClose={() => setOpen(false)}
                footer={
                    <PaperButton variant="primary" onClick={() => setOpen(false)}>
                        Confirm
                    </PaperButton>
                }
            >
                <PaperText preset="body">Are you sure you want to proceed with this operation?</PaperText>
            </PaperModal>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperButton variant="primary" onClick={() => setOpen(true)}>
                    Open dialog
                </PaperButton>

                <PaperModal
                    open={open()}
                    title="Confirmation"
                    onClose={() => setOpen(false)}
                    footer={
                        <PaperButton variant="primary" onClick={() => setOpen(false)}>
                            Confirm
                        </PaperButton>
                    }
                >
                    <PaperText preset="body">Are you sure you want to proceed with this operation?</PaperText>
                </PaperModal>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperModal accepts the following configuration properties:
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Prop</th>
                            <th>Type</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>open</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Controls modal visibility.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onClose</PaperCode></td>
                            <td><PaperCode>() =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Invoked when the user clicks the backdrop, presses Escape, or triggers the close button.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Heading text displayed in the modal header.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>"small" | "medium" | "large" | "full"</PaperCode></td>
                            <td><PaperCode>"medium"</PaperCode></td>
                            <td>Width bound preset: small (420px), medium (600px), large (760px), full (920px).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullscreen</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Expands the modal box to fill the entire viewport window.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>footer</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Action button container rendered along the bottom edge.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperModal mounts into a portal layer appended to the document body.
                While open, focus is trapped inside the dialog and restored to the prior element upon dismissal.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use the small size for compact confirmation dialogs.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperModal open={open()} size="small" title="Delete record" onClose={() => setOpen(false)}>
    <PaperText preset="body">This action removes the record permanently.</PaperText>
</PaperModal>`}
            </PaperCode>
        </PaperFlex>
    );
}
