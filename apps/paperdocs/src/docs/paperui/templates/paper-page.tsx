import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperPage,
    PaperPageHeader,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperPageDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPage</PaperText>
            <PaperText preset="body" as="p">
                PaperPage is the centered content column of a panel screen: full width up to a readable maximum, padded, and spaced.
                A page item of a <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink> already wraps its content in one.
                Use PaperPage directly for a single-screen panel or any screen outside an interface group.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put a header and cards inside it.
                Children stack in a column with a <PaperCode>full</PaperCode> gap.
            </PaperText>
            <PaperCard data-docs-demo padding="none" surface="back">
                <PaperPage padding="full">
                    <PaperPageHeader icon="home" title="Page" subtitle="A header over a card" />
                    <PaperCard padding="full">
                        <PaperText>Content of the page.</PaperText>
                    </PaperCard>
                </PaperPage>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperPage, PaperPageHeader, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperPage padding="full">
            <PaperPageHeader icon="home" title="Page" subtitle="A header over a card" />
            <PaperCard padding="full">
                <PaperText>Content of the page.</PaperText>
            </PaperCard>
        </PaperPage>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPageProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and the layout props, except <PaperCode>width</PaperCode>, which PaperPage uses to name its column.
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
                        <td><PaperCode>width</PaperCode></td>
                        <td><PaperCode>"standard" | "wide" | "full"</PaperCode></td>
                        <td><PaperCode>"standard"</PaperCode></td>
                        <td>The column's maximum width: 992px, 1400px, or no maximum. The column is centered and shrinks with the window.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>padding</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td><PaperCode>"double"</PaperCode></td>
                        <td>Inner space on all sides.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>gap</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td><PaperCode>"full"</PaperCode></td>
                        <td>Space between children.</td>
                    </tr>
                    <tr>
                        <td>Layout props</td>
                        <td><PaperCode>PaperLayoutProps</PaperCode></td>
                        <td>No default</td>
                        <td>Described in <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>. They are written to the style, so <PaperCode>maxWidth</PaperCode> overrides the column's maximum. The props are flex, grow, shrink, minWidth, minHeight, maxWidth, maxHeight, height, fullWidth, fullHeight, scrollable, overflow, overflowX, overflowY.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element. An object <PaperCode>style</PaperCode> is merged last.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The page is a column that is 100% wide, centered with auto margins, and grows to fill its parent's height, so an empty state under a header can sit in the middle of what is left.</li>
                <li>It does not scroll by itself. Inside a page item of an interface group the item scrolls. Elsewhere give it <PaperCode>scrollable</PaperCode> and a bounded height, such as <PaperCode>fullHeight</PaperCode>.</li>
                <li>The default padding is large for a desktop window. A panel that is mostly cards usually passes <PaperCode>padding="full"</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="single-screen">A single-screen panel</PaperText>
            <PaperCode block language="tsx">
{`import { render } from "solid-js/web";
import { PaperCard, PaperPage, PaperPageHeader, PaperProvider, PaperText } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

const root = document.getElementById("app");
if (!root) throw new Error("The #app element is missing");

render(
    () => (
        <PaperProvider fullWidth fullHeight>
            <PaperPage fullHeight scrollable>
                <PaperPageHeader icon="info" title="Status" />
                <PaperCard padding="full">
                    <PaperText>Everything is running.</PaperText>
                </PaperCard>
            </PaperPage>
        </PaperProvider>
    ),
    root,
);`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="wide">A wide page</PaperText>
            <PaperCode block language="tsx">
{`<PaperPage width="wide">
    <PaperPageHeader icon="table_rows" title="Servers" />
</PaperPage>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>The page of a panel with a menu is an item of <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink>, which wraps it for you.</li>
                <li>A container with no centered column is <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink>.</li>
                <li>The header at the top of a page is <PaperLink href="/docs/paperui/paperpageheader/">PaperPageHeader</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
