import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperModal,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [isModalOpen, setIsModalOpen] = createSignal(false);
    const [modalSize, setModalSize] = createSignal<"small" | "medium" | "large">("medium");

    const openWithSize = (size: "small" | "medium" | "large") => {
        setModalSize(size);
        setIsModalOpen(true);
    };

    return (
        <>
            <PaperText preset="header">PaperModal</PaperText>
            <PaperText preset="body">
                <strong>PaperModal</strong> is a portal-rendered dialog overlay primitive supporting animated transitions, focus entrapment, backdrop dismissal, keyboard shortcuts, and structured header/footer slots.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperModal</strong> presents focused dialog interactions detached from standard document flow via SolidJS <PaperCode>&lt;Portal&gt;</PaperCode>. It traps keyboard focus within the dialog container, restores focus to the previously active element upon dismissal, handles <PaperCode>Escape</PaperCode> keypresses, and provides predefined dimensional presets (<PaperCode>"small"</PaperCode>, <PaperCode>"medium"</PaperCode>, <PaperCode>"large"</PaperCode>, <PaperCode>"full"</PaperCode>).
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Modals are controlled via the <PaperCode>open</PaperCode> and <PaperCode>onClose</PaperCode> props:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperModal, PaperButton, PaperText, PaperFlex } from "@paperboard-dev/paperui";

function DialogDemo() {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
        <>
            <PaperButton variant="blue" onClick={() => setIsOpen(true)}>
                Open Modal
            </PaperButton>

            <PaperModal
                open={isOpen()}
                onClose={() => setIsOpen(false)}
                title="Confirm Workspace Export"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half">
                        <PaperButton compact onClick={() => setIsOpen(false)}>Cancel</PaperButton>
                        <PaperButton compact variant="green" onClick={() => setIsOpen(false)}>
                            Confirm Export
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    Are you sure you want to export all configuration archives?
                </PaperText>
            </PaperModal>
        </>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half" wrap>
                    <PaperButton variant="blue" onClick={() => openWithSize("small")}>
                        Open Small Modal
                    </PaperButton>
                    <PaperButton variant="brand" onClick={() => openWithSize("medium")}>
                        Open Medium Modal
                    </PaperButton>
                    <PaperButton variant="green" onClick={() => openWithSize("large")}>
                        Open Large Modal
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>

            <PaperModal
                open={isModalOpen()}
                onClose={() => setIsModalOpen(false)}
                title={`${modalSize().toUpperCase()} Dialog Modal`}
                size={modalSize()}
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" style={{ width: "100%" }}>
                        <PaperButton compact onClick={() => setIsModalOpen(false)}>Dismiss</PaperButton>
                        <PaperButton compact variant="brand" onClick={() => setIsModalOpen(false)}>
                            Save Changes
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex gap="half">
                    <PaperText preset="body">
                        This is an active demonstration of <PaperCode>PaperModal</PaperCode> with focus entrapment and animated transitions.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        Press <PaperCode>Esc</PaperCode> or click the backdrop to close.
                    </PaperText>
                </PaperFlex>
            </PaperModal>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
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
                        <td>Controls the open/closed visibility state of the modal dialog.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed when dismissing via backdrop, close button, or Escape key.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Header title text string rendered at the top of the dialog.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>"small" | "medium" | "large" | "full"</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td>Predefined width/height constraint preset for the dialog window.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullscreen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Expands the modal to occupy 100vw and 100vh without rounded borders.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>noHeader</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Hides the header bar. When onClose is supplied, a floating close button is absolutely positioned in the top-right corner.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>noPadding</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Removes default inner body padding so full-bleed components (such as PaperWizard) fit flush with the modal edges.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnBackdropClick</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Enables dismissal when clicking outside the dialog content box.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnEsc</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Enables dismissal when pressing the Escape keyboard key.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>footer</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Action buttons rendered inside the pinned modal footer bar.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercontextmenu">PaperContextMenu</PaperLink> — Portal-based dropdown and context menu.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercenteredinterface">PaperCenteredInterface</PaperLink> — Inline centered layout template.
                </PaperText>
            </PaperTextList>
        </>
    );
}
