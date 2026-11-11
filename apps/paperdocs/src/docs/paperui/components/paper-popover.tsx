import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperList,
    PaperListItem,
    PaperPopover,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

function ListDemo() {
    let anchor: HTMLButtonElement | undefined;
    const [open, setOpen] = createSignal(false);
    return (
        <>
            <PaperButton ref={anchor} onClick={() => setOpen(!open())}>Show the list</PaperButton>
            <PaperPopover open={open()} anchor={anchor} onClose={() => setOpen(false)} title="Updates" flush>
                <PaperList selectable={false} fullWidth borderless scrollable={false}>
                    <PaperListItem value="gameserver" loaderStatus="loading" percent={60} description="Downloading 6.0 MB of 10.0 MB">Game Server</PaperListItem>
                    <PaperListItem value="java" loaderStatus="waiting" description="Waiting">Java 21</PaperListItem>
                </PaperList>
            </PaperPopover>
        </>
    );
}

function Demo() {
    let anchor: HTMLButtonElement | undefined;
    const [open, setOpen] = createSignal(false);
    return (
        <>
            <PaperButton ref={anchor} onClick={() => setOpen(!open())}>Show updates</PaperButton>
            <PaperPopover open={open()} anchor={anchor} onClose={() => setOpen(false)} aria-label="Updates">
                <PaperText preset="text">Java 21 needs to be updated, but Game Server is using it.</PaperText>
                <PaperButton size="small" onClick={() => setOpen(false)}>Stop and update</PaperButton>
            </PaperPopover>
        </>
    );
}

export default function PaperPopoverDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPopover</PaperText>
            <PaperText preset="body" as="p">
                PaperPopover is a small bubble that points at the control that opened it, with a tail toward it.
                Use it for what a button is doing, a short question about it, or a few controls, where a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> would take over the page.
                It does not dim the page or take focus from it.
                Use <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> for a list of commands instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Keep a reference to the element it points at, and pass it as <PaperCode>anchor</PaperCode>.
                The popover is controlled: <PaperCode>open</PaperCode> shows it, and <PaperCode>onClose</PaperCode> asks you to hide it.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <Demo />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperPopover, PaperText } from "@mileniumhq/paperui";

export function Example() {
    let anchor: HTMLButtonElement | undefined;
    const [open, setOpen] = createSignal(false);
    return (
        <>
            <PaperButton ref={anchor} onClick={() => setOpen(!open())}>Show updates</PaperButton>
            <PaperPopover open={open()} anchor={anchor} onClose={() => setOpen(false)} aria-label="Updates">
                <PaperText preset="text">Java 21 needs to be updated, but Game Server is using it.</PaperText>
                <PaperButton size="small" onClick={stopAndUpdate}>Stop and update</PaperButton>
            </PaperPopover>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPopoverProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the bubble, which has the <PaperCode>dialog</PaperCode> role: give it an <PaperCode>aria-label</PaperCode> when it has no title.
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
                        <td>No default (required)</td>
                        <td>Whether it shows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>anchor</PaperCode></td>
                        <td><PaperCode>HTMLElement | undefined</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The element it points at. It follows the element as the layout moves.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called on Escape and on a press outside the popover and its anchor.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placement</PaperCode></td>
                        <td><PaperCode>"below" | "above"</PaperCode></td>
                        <td><PaperCode>"below"</PaperCode></td>
                        <td>The side of the anchor it opens on. It flips when only the other side has room.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A label above the content. A string is shown as a label preset, or as a section label with <PaperCode>flush</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flush</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>The content fills the bubble edge to edge, for a <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>. The bubble takes the list's inset surface, and the title sits over the list like a <PaperCode>PaperListLabel</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnOutside</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Whether a press outside calls <PaperCode>onClose</PaperCode>. Escape always does.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>It is always one width, the width of a menu (or the window, less a margin, when that is narrower), so it doesn't jump as its content changes. Text wraps inside it.</li>
                <li>It is centered on its anchor and kept inside the window. The tail keeps pointing at the anchor's center when the bubble has to move.</li>
                <li>It sits above the window's chrome, so a popover can point at a button in the top bar.</li>
                <li>A press on the anchor does not close it: the anchor's own click decides, so the button that opens it also closes it.</li>
                <li>Content taller than the window scrolls inside the bubble.</li>
                <li>It fades and scales in from its tail. Under reduced motion it appears at once.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="list">A list in a popover</PaperText>
            <PaperText preset="body" as="p">
                The top bar's update list is a <PaperCode>flush</PaperCode> popover holding a list that can't be selected.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <ListDemo />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperPopover open={open()} anchor={anchor} onClose={() => setOpen(false)} title="Updates" flush>
    <PaperList selectable={false} fullWidth borderless scrollable={false}>
        <PaperListItem value="gameserver" loaderStatus="loading" percent={60} description="Downloading 6.0 MB of 10.0 MB">
            Game Server
        </PaperListItem>
        <PaperListItem value="java" loaderStatus="waiting" description="Waiting">Java 21</PaperListItem>
    </PaperList>
</PaperPopover>`}
            </PaperCode>
        </PaperFlex>
    );
}
