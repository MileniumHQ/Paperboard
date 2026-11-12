import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSplit,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSplitDoc() {
    const [detail, setDetail] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSplit</PaperText>
            <PaperText preset="body" as="p">
                PaperSplit is a master-detail layout: a list pane of fixed width beside a detail pane that takes the rest.
                When the container is too narrow, the list fills the space and the detail slides in over it as a page.
                A panel works at Paperboard's smallest window without any media query of its own.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the list as <PaperCode>side</PaperCode> and the detail as children.
                Track which item is selected, and pass <PaperCode>detailActive</PaperCode> and <PaperCode>onDetailClose</PaperCode> so the collapsed layout can open and close the page.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back" height="panel-height">
                <PaperSplit
                    sideWidth="var(--paper-size-field-wide)"
                    collapseWidth={400}
                    detailActive={detail()}
                    onDetailClose={() => setDetail(false)}
                    detailTitle="Detail"
                    side={
                        <PaperCard padding="full" surface="frontest" fullHeight>
                            <PaperFlex direction="column" gap="half">
                                <PaperText preset="label">List</PaperText>
                                <PaperButton onClick={() => setDetail(true)}>Open item</PaperButton>
                            </PaperFlex>
                        </PaperCard>
                    }
                >
                    <PaperCard padding="full" surface="frontest" fullHeight>
                        <PaperText>The detail of the selected item.</PaperText>
                    </PaperCard>
                </PaperSplit>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperSplit, PaperText } from "@mileniumhq/paperui";

export function Example() {
    const [detail, setDetail] = createSignal(false);

    return (
        <PaperSplit
            sideWidth="var(--paper-size-field-wide)"
            collapseWidth={400}
            detailActive={detail()}
            onDetailClose={() => setDetail(false)}
            detailTitle="Detail"
            side={
                <PaperCard padding="full" surface="frontest" fullHeight>
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="label">List</PaperText>
                        <PaperButton onClick={() => setDetail(true)}>Open item</PaperButton>
                    </PaperFlex>
                </PaperCard>
            }
        >
            <PaperCard padding="full" surface="frontest" fullHeight>
                <PaperText>The detail of the selected item.</PaperText>
            </PaperCard>
        </PaperSplit>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSplitProps does not extend the HTML attributes, so only the props below exist.
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
                        <td><PaperCode>side</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>Required</td>
                        <td>The list or roster pane.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>Required</td>
                        <td>The detail pane.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sideWidth</PaperCode></td>
                        <td><PaperCode>number | string</PaperCode></td>
                        <td>The <PaperCode>split-side</PaperCode> size (320px)</td>
                        <td>The side pane's width. A number is pixels. A string is used as written and is not read as a size token, so pass <PaperCode>getVarCss("size-field-wide")</PaperCode> or <PaperCode>"var(--paper-size-field-wide)"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>collapseWidth</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>680</PaperCode></td>
                        <td>The container width, in pixels, below which the layout collapses to one pane.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detailActive</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (closed)</td>
                        <td>Whether the detail page is open. Used only while collapsed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onDetailClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the detail closes. Collapsed, it comes once the page has slid away, so the detail keeps what it showed until then. Set your selection state back in it, or the page opens again.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detailTitle</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The page's title while collapsed. In a Paperboard panel it is the last crumb in the app's top bar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onCollapsedChange</PaperCode></td>
                        <td><PaperCode>(collapsed: boolean) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the current state at mount and whenever it changes. Use it to change the list's behavior in the single-pane layout, such as a selection that must not toggle.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The root is 100% wide and tall. Give it a parent with a height, such as a page item with the <PaperCode>fill</PaperCode> variant.</li>
                <li>The layout is chosen from the root's own width, measured with a resize observer, not from the screen. The first render is side by side, and it collapses once the width is below <PaperCode>collapseWidth</PaperCode>.</li>
                <li>Side by side, the panes are a row with a <PaperCode>full</PaperCode> gap. The side pane is fixed, the detail pane flexes. <PaperCode>detailActive</PaperCode> is ignored and the detail always shows, so draw an empty state in it when nothing is selected.</li>
                <li>Collapsed, the side pane fills the root and the detail is a fixed <PaperLink href="/docs/paperui/paperslidepage/">PaperSlidePage</PaperLink> (in a panel, it covers the panel), open while <PaperCode>detailActive</PaperCode> is true. Its back button, the system Back action and the back swipe slide it away, then call <PaperCode>onDetailClose</PaperCode>.</li>
                <li>Crossing the breakpoint rebuilds the panes, so state held inside the side or detail content is lost. Keep selection and drafts in signals outside the split.</li>
                <li>Each pane is a flex box. Give a card that should fill its pane <PaperCode>fullHeight</PaperCode>, as the samples do.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="selection">Selection that follows the layout</PaperText>
            <PaperText preset="body" as="p">
                Side by side, picking an item shows it in the detail pane.
                Collapsed, picking an item opens the page, and closing it clears the selection once the page is gone.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperSplit,
    PaperText,
} from "@mileniumhq/paperui";

const ITEMS = ["First", "Second", "Third"];

export function Items() {
    const [selected, setSelected] = createSignal<string | null>(null);

    return (
        <PaperSplit
            detailActive={selected() !== null}
            onDetailClose={() => setSelected(null)}
            detailTitle={selected() ?? undefined}
            side={
                <PaperCard padding="full" surface="frontest" fullHeight>
                    <PaperFlex direction="column" gap="half">
                        <For each={ITEMS}>
                            {(item) => <PaperButton onClick={() => setSelected(item)}>{item}</PaperButton>}
                        </For>
                    </PaperFlex>
                </PaperCard>
            }
        >
            <Show
                when={selected()}
                fallback={<PaperEmptyState icon="touch_app" title="No item selected" />}
            >
                {(item) => (
                    <PaperCard padding="full" surface="frontest" fullHeight>
                        <PaperText>{item()}</PaperText>
                    </PaperCard>
                )}
            </Show>
        </PaperSplit>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A menu of whole screens is <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink>, which turns into pages on a phone.</li>
                <li>A browsable file tree beside an editor is <PaperLink href="/docs/paperui/paperfilebrowser/">PaperFileBrowser</PaperLink>, which is built on PaperSplit.</li>
                <li>Rows and columns with no collapse are <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
