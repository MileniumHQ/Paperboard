import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEmptyState,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperEmptyStateDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperEmptyState</PaperText>
            <PaperText preset="body" as="p">
                PaperEmptyState is the centered block a panel shows when there is nothing to list: an icon, a title, a description, and optional actions.
                Use it for an empty list, a stopped server, a view that couldn't load, or a search with no results.
                It tells the user why the space is empty and what to do next.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass an <PaperCode>icon</PaperCode> name, a <PaperCode>title</PaperCode>, and a <PaperCode>description</PaperCode>.
                Children render as the action row under the text.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperEmptyState icon="inbox" title="Title" description="Description">
                    <PaperButton variant="primary">Button</PaperButton>
                </PaperEmptyState>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperEmptyState } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard surface="front">
            <PaperEmptyState icon="inbox" title="Title" description="Description">
                <PaperButton variant="primary">Button</PaperButton>
            </PaperEmptyState>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperEmptyStateProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>, which takes elements here.
                Other props land on the root <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>A string is a Material icon name, drawn large and faint. An element is rendered as is, without that styling.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no title)</td>
                        <td>The headline, in the label text style. Say what is missing: "No players online".</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no description)</td>
                        <td>One line of hint text under the title. Say what to do or why it is empty.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Actions, laid out in a centered row. Hidden when empty.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Each part renders only when its prop is set, so an empty state can be an icon and a title alone.</li>
                <li>The block is full width, centered, and takes the space a column parent has left, so it sits in the middle of an empty panel body instead of under the header.</li>
                <li>It has no role and does not announce itself.</li>
                <li>It is passive: it holds no state and fires no events. Actions are your own controls in the children.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="empty-list">An empty list with an action</PaperText>
            <PaperText preset="body" as="p">
                Swap the list for the empty state with <PaperCode>Show</PaperCode>, and offer the action that fills it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { For, Show } from "solid-js";
import { PaperButton, PaperEmptyState, PaperText } from "@mileniumhq/paperui";

export function Projects(props: { projects: string[]; create: () => void }) {
    return (
        <Show
            when={props.projects.length > 0}
            fallback={
                <PaperEmptyState icon="folder_open" title="No projects" description="Create a project to get started.">
                    <PaperButton variant="primary" onClick={props.create}>Create project</PaperButton>
                </PaperEmptyState>
            }
        >
            <For each={props.projects}>
                {(project) => <PaperText preset="body" as="p">{project}</PaperText>}
            </For>
        </Show>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="couldnt-load">Couldn't load</PaperText>
            <PaperText preset="body" as="p">
                A view that failed to load and has nothing to show never leaves its body blank: it shows a neutral "Couldn't load" with Try again.
                The reason is said once, in the toast that <PaperLink href="/docs/paperui/state/#create-read">createRead</PaperLink>'s <PaperCode>failure</PaperCode> shows, so the empty state doesn't repeat it.
                A view that still has its old data keeps it on screen, and only the toast says the reload failed.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperEmptyState icon="error" title="Couldn't load">
                    <PaperButton>Try again</PaperButton>
                </PaperEmptyState>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createRead, PaperButton, PaperEmptyState, PaperLoader } from "@mileniumhq/paperui";

const logs = createRead(() => service.calls.readLogs(), { failure: { title: "Couldn't load the logs" } });

<Switch>
    <Match when={logs.value()}>{(lines) => <LogLines lines={lines()} />}</Match>
    <Match when={logs.error()}>
        <PaperEmptyState icon="error" title="Couldn't load">
            <PaperButton disabled={logs.loading()} onClick={() => void logs.reload()}>Try again</PaperButton>
        </PaperEmptyState>
    </Match>
    <Match when={true}>
        <PaperLoader loaderStatus="indeterminate" label="Reading logs" />
    </Match>
</Switch>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> for a note that sits beside content, such as a warning above a form, and PaperEmptyState when there is no content to put it beside. A failure is neither: it is a <PaperLink href="/docs/paperui/papertoast/">toast</PaperLink>.
                Pass a PaperEmptyState as the <PaperCode>empty</PaperCode> prop of <PaperLink href="/docs/paperui/paperconsole/">PaperConsole</PaperLink> for a quiet log.
            </PaperText>
        </PaperFlex>
    );
}
