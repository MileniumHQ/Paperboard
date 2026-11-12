import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperPagination,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperPaginationDoc() {
    const [page, setPage] = createSignal(4);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPagination</PaperText>
            <PaperText preset="body" as="p">
                PaperPagination is a row of page buttons with previous and next arrows, for moving through a list that you split into pages.
                Use it under a grid or table that shows one page of results at a time.
                It only draws the controls: you hold the current page and slice the data.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>page</PaperCode> and <PaperCode>pageCount</PaperCode> are required.
                Keep the page in a signal and set it from <PaperCode>onPageChange</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperPagination page={page()} pageCount={12} onPageChange={setPage} label="Example pages" />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperPagination } from "@mileniumhq/paperui";

export function Example() {
    const [page, setPage] = createSignal(4);

    return <PaperPagination page={page()} pageCount={12} onPageChange={setPage} label="Example pages" />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPaginationProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLElement&gt;</PaperCode> without <PaperCode>onChange</PaperCode>.
                Other props land on the <PaperCode>nav</PaperCode> element.
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
                        <td><PaperCode>page</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The current page, counting from 1. It is rounded and clamped between 1 and <PaperCode>pageCount</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pageCount</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (required)</td>
                        <td>How many pages there are, rounded down. With 1 or fewer the component renders nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onPageChange</PaperCode></td>
                        <td><PaperCode>(page: number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the page the user chose. It is not called for the current page, for a page out of range, or while disabled. The component does not move on its own: update <PaperCode>page</PaperCode> in this handler.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>siblings</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>1</PaperCode></td>
                        <td>How many page buttons show on each side of the current page. The first and last page always show.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables every button, for example while a page loads.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Pagination"</PaperCode></td>
                        <td>The <PaperCode>aria-label</PaperCode> of the navigation landmark. Give each pagination on a page its own name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the <PaperCode>nav</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The row is the previous arrow, the first page, a window around the current page, the last page, and the next arrow. A run of skipped pages shows as an ellipsis.</li>
                <li>The current page is a primary button with <PaperCode>aria-current="page"</PaperCode>. Other pages are text buttons.</li>
                <li>Page buttons are named <PaperCode>Page 3</PaperCode> and the arrows <PaperCode>Previous page</PaperCode> and <PaperCode>Next page</PaperCode>. The ellipsis is hidden from assistive technology.</li>
                <li>The arrows disable at the first and last page.</li>
                <li>The component does not slice your data or keep the page in range when the data shrinks. Clamp your own page signal when <PaperCode>pageCount</PaperCode> falls.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="grid">Under a grid of cards</PaperText>
            <PaperText preset="body" as="p">
                The AI panel's model browser shows a fixed number of cards per page, then the pagination, then a count.
                Scroll back to the top of the list in the handler if the page is long.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createMemo, createSignal, For } from "solid-js";
import { PaperMediaCard, PaperMediaCardGroup, PaperPagination } from "@mileniumhq/paperui";

const PER_PAGE = 12;

export function Models(props: { models: { id: string; name: string }[] }) {
    const [page, setPage] = createSignal(1);
    const pageCount = createMemo(() => Math.ceil(props.models.length / PER_PAGE));
    const visible = createMemo(() => {
        const start = (Math.min(page(), pageCount()) - 1) * PER_PAGE;
        return props.models.slice(start, start + PER_PAGE);
    });

    return (
        <>
            <PaperMediaCardGroup>
                <For each={visible()}>{(model) => <PaperMediaCard title={model.name} />}</For>
            </PaperMediaCardGroup>
            <PaperPagination page={page()} pageCount={pageCount()} onPageChange={setPage} label="Model pages" />
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>For a list that grows as the user scrolls, use <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink> instead of pages.</li>
                <li>For a small set of views, use <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> as tabs.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
