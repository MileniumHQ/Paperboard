import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperPagination,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { createSignal } from "solid-js";

export default function PaperPaginationDoc() {
    const [page, setPage] = createSignal(3);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperPagination</PaperText>
            <PaperText preset="body">
                PaperPagination renders compact page navigation for paged lists and grids.
                Reach for PaperPagination when a collection is split into pages instead of growing forever.
                The first and last page are always reachable, the current page is clamped into range, and skipped runs collapse into an ellipsis.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Drive it with the 1-based page and total pageCount; onPageChange reports the requested page and never fires for the current page or while disabled.
                A count of one page renders nothing.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperPagination } from "@mileniumhq/paperui";
import { createSignal } from "solid-js";

export function Example() {
    const [page, setPage] = createSignal(1);

    return (
        <PaperPagination page={page()} pageCount={12} onPageChange={setPage} />
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperPagination page={page()} pageCount={12} onPageChange={setPage} />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperPagination accepts the following configuration properties:
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
                            <td><PaperCode>page</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td>No default</td>
                            <td>Current page, 1-based. Values outside the range are clamped.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>pageCount</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td>No default</td>
                            <td>Total number of pages. One or fewer renders nothing.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onPageChange</PaperCode></td>
                            <td><PaperCode>(page: number) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Called with the requested page when a control is activated.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Disables every control and suppresses onPageChange.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>siblings</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>1</PaperCode></td>
                            <td>Page buttons kept on each side of the current page before collapsing into an ellipsis.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"Pagination"</PaperCode></td>
                            <td>Accessible name for the navigation landmark.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The current page carries aria-current="page" and every control has an accessible name, including the previous and next arrows.
                Previous and next are disabled at the ends of the range.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Pair PaperPagination with a paged grid and reset the page when the filter changes.
            </PaperText>
            <PaperCode block language="tsx">
{`const [query, setQuery] = createSignal("");
const [page, setPage] = createSignal(1);
const results = createMemo(() => search(query()));

<PaperPagination page={page()} pageCount={Math.ceil(results().length / 24)} onPageChange={setPage} />`}
            </PaperCode>
        </PaperFlex>
    );
}
