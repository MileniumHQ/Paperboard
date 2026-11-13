import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperLoader,
    PaperLoaderGroup,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperLoaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperLoader</PaperText>
            <PaperText preset="body" as="p">
                PaperLoader is a ring that shows the progress of one task, with an optional label beside it.
                Use it for a wait you cannot cover with content, such as a first load or an install step, in five states from spinning to finished or failed.
                Use <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink> for a bar inside a row or a toolbar instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>loaderStatus</PaperCode> is the only required prop.
                Pass <PaperCode>"indeterminate"</PaperCode> when you do not know how long the wait is, and <PaperCode>"loading"</PaperCode> with <PaperCode>percent</PaperCode> when you do.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperLoader loaderStatus="indeterminate" label="Loading servers" />
                    <PaperLoader loaderStatus="loading" percent={60} label="Downloading" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperLoader } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="full">
            <PaperLoader loaderStatus="indeterminate" label="Loading servers" />
            <PaperLoader loaderStatus="loading" percent={60} label="Downloading" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="loader-props">PaperLoader</PaperText>
            <PaperText preset="body" as="p">
                PaperLoaderProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the wrapping <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>loaderStatus</PaperCode></td>
                        <td><PaperCode>LoaderStatus</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The state, one of <PaperCode>"loading"</PaperCode>, <PaperCode>"indeterminate"</PaperCode>, <PaperCode>"success"</PaperCode>, <PaperCode>"error"</PaperCode>, or <PaperCode>"waiting"</PaperCode>. See States.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>percent</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>0</PaperCode></td>
                        <td>How much of the ring is filled, from 0 to 100. Values outside the range are clamped. Only <PaperCode>"loading"</PaperCode> reads it for the fill.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperLoaderSize</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td><PaperCode>"small"</PaperCode>, <PaperCode>"medium"</PaperCode>, or <PaperCode>"large"</PaperCode>. The ring takes the size of an icon, a medium control, or a large control. A small loader also shrinks its label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Text beside the ring. Without it only the ring shows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subtitle</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A short uppercase line under the label, in subtle text. Use it for how much a download has done, written with <PaperLink href="/docs/paperui/utilities/#byte-progress">formatByteProgress</PaperLink>. See Subtitle.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Something short inside the ring, such as how many steps are left. It is sized from the ring, and makes way for the check or close mark when the loader finishes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>centered</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Fills its container and sits in the middle of it, with a double gap from every edge, the label centered and wrapping under the ring. The way to show that a whole page or area is loading.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>delay</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (shows at once)</td>
                        <td>Milliseconds to wait before the loader appears. A wait that ends sooner never flashes a loader. It is read once, when the loader is created.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td><PaperCode>classList</PaperCode> and an object <PaperCode>style</PaperCode> are added to the wrapper. <PaperCode>class</PaperCode> is added to the ring itself. A string <PaperCode>style</PaperCode> is ignored.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>LoaderStatus</PaperCode> and <PaperCode>PaperLoaderSize</PaperCode> are exported from <PaperCode>@mileniumhq/paperui</PaperCode>:
            </PaperText>
            <PaperCode block language="ts">
{`type LoaderStatus = "loading" | "indeterminate" | "success" | "error" | "waiting";
type PaperLoaderSize = "small" | "medium" | "large";`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="group-props">PaperLoaderGroup</PaperText>
            <PaperText preset="body" as="p">
                PaperLoaderGroup stacks loaders in a column at a fixed width, so a list of steps lines up.
                It takes <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and children, and has no props of its own.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="states">States</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>What shows</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"loading"</PaperCode></td>
                        <td>A primary-colored arc filled to <PaperCode>percent</PaperCode>. At 0 the arc is hidden and only the track shows. Changes animate.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"indeterminate"</PaperCode></td>
                        <td>A short arc that spins. <PaperCode>percent</PaperCode> is ignored. Moving to or from another status cross-fades.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"success"</PaperCode></td>
                        <td>A full success-colored ring with a check mark filling the center, and a one-time ripple.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"error"</PaperCode></td>
                        <td>A danger-colored ring with a close mark filling the center.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"waiting"</PaperCode></td>
                        <td>The whole loader at half opacity, for a step that has not started. It shows an arc only if <PaperCode>percent</PaperCode> is above 0.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="delay">Delay</PaperText>
            <PaperTextList>
                <li>With <PaperCode>delay</PaperCode> the component renders nothing until the timer fires, so the loader and its label are absent from the page, not hidden.</li>
                <li>The timer is cleared when the loader is removed. A later change to <PaperCode>delay</PaperCode> does not restart it.</li>
                <li>Pick a delay of a few hundred milliseconds for a request that is usually fast. The gameserver panel uses 400 for its server list.</li>
                <li>The loader fades in when it appears, with or without a delay, so it never pops onto an empty page. Under reduced motion it appears at once.</li>
                <li>To show that a whole page or area is loading, give the loader <PaperCode>centered</PaperCode>: it fills its container and sits in the middle, never against an edge, on a phone as on a desktop. Without it, the loader sits inline where it's placed.</li>
                <li>A <PaperCode>PaperLoaderGroup</PaperCode> is never wider than the room it has.</li>
                <li>A loader that finishes in front of the person is felt where the device supports it: the <PaperCode>loaded</PaperCode> haptic with the check's pop and ripple, or <PaperCode>failed</PaperCode>'s two knocks. Loaders finishing together are felt once.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperText preset="body" as="p">
                The ring is an SVG with no role and no live region.
                The label is the only text an assistive technology reads, so write a label that names the task, such as "Loading servers", rather than leaving a bare ring.
                When a loader fails, show the failure in text too, with <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="statuses">All statuses</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperLoaderGroup>
                    <PaperLoader loaderStatus="waiting" label="Waiting" />
                    <PaperLoader loaderStatus="indeterminate" label="Indeterminate" />
                    <PaperLoader loaderStatus="loading" percent={40} label="Loading" />
                    <PaperLoader loaderStatus="success" label="Success" />
                    <PaperLoader loaderStatus="error" label="Error" />
                </PaperLoaderGroup>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperLoader, PaperLoaderGroup } from "@mileniumhq/paperui";

<PaperLoaderGroup>
    <PaperLoader loaderStatus="waiting" label="Waiting" />
    <PaperLoader loaderStatus="indeterminate" label="Indeterminate" />
    <PaperLoader loaderStatus="loading" percent={40} label="Loading" />
    <PaperLoader loaderStatus="success" label="Success" />
    <PaperLoader loaderStatus="error" label="Error" />
</PaperLoaderGroup>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="sizes">Sizes</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperLoader size="small" loaderStatus="indeterminate" label="Small" />
                    <PaperLoader size="medium" loaderStatus="indeterminate" label="Medium" />
                    <PaperLoader size="large" loaderStatus="indeterminate" label="Large" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperLoader size="small" loaderStatus="indeterminate" label="Small" />
    <PaperLoader size="medium" loaderStatus="indeterminate" label="Medium" />
    <PaperLoader size="large" loaderStatus="indeterminate" label="Large" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="subtitle">Subtitle</PaperText>
            <PaperText preset="body" as="p">
                Anything that downloads shows how much has arrived under its label, with the <PaperCode>section</PaperCode> text preset.
                Give the amount only while the step is running and the download reports its size, so the line never reads zero or guesses.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperLoaderGroup>
                    <PaperLoader loaderStatus="success" label="Downloading Java..." />
                    <PaperLoader loaderStatus="loading" percent={93} label="Downloading Counter-Strike 2 from Steam..." subtitle="5.6 / 6 GB" />
                    <PaperLoader loaderStatus="waiting" label="Setting up server..." />
                </PaperLoaderGroup>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { formatByteProgress, PaperLoader } from "@mileniumhq/paperui";

<PaperLoader
    loaderStatus="loading"
    percent={progress().percent}
    label="Downloading Counter-Strike 2 from Steam..."
    subtitle={progress().bytes ? formatByteProgress(progress().bytes.done, progress().bytes.total) : undefined}
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="count">A count inside the ring</PaperText>
            <PaperText preset="body" as="p">
                Children sit in the middle of the ring. Paperboard's update button shows how many updates are left this way, and the count gives way to the check when they finish.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperLoader size="small" loaderStatus="loading" percent={40}>3</PaperLoader>
                    <PaperLoader loaderStatus="loading" percent={70}>2</PaperLoader>
                    <PaperLoader loaderStatus="success">2</PaperLoader>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperLoader size="small" loaderStatus="loading" percent={40}>
    {left()}
</PaperLoader>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="first-load">First load with a delay</PaperText>
            <PaperText preset="body" as="p">
                Show the loader as the <PaperCode>fallback</PaperCode> of a <PaperCode>Show</PaperCode> that waits for data.
                The delay keeps a fast response from flashing a spinner.
                A failed load needs its own branch, because the loader has no error of its own to show a reason.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createResource, Show } from "solid-js";
import { PaperFlex, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";

async function readServers(): Promise<string[]> {
    const response = await fetch("/servers.json");
    if (!response.ok) throw new Error("The server list could not be read");
    return response.json();
}

export function Servers() {
    const [servers] = createResource(readServers);

    return (
        <Show
            when={!servers.error}
            fallback={<PaperQuote variant="danger">{servers.error.message}</PaperQuote>}
        >
            <Show
                when={servers()}
                fallback={
                    <PaperFlex fullWidth fullHeight align="center" justify="center">
                        <PaperLoader loaderStatus="indeterminate" delay={400} label="Loading servers" />
                    </PaperFlex>
                }
            >
                {(list) => <PaperText preset="body" as="p">{list().length} servers</PaperText>}
            </Show>
        </Show>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="install-steps">Install steps</PaperText>
            <PaperText preset="body" as="p">
                One loader per step in a <PaperCode>PaperLoaderGroup</PaperCode>, each bound to its own signals.
                The gameserver panel's install screen works this way, with the amount downloaded in each download's subtitle.
            </PaperText>
            <PaperCode block language="tsx">
{`import { For, type Accessor } from "solid-js";
import { PaperLoader, PaperLoaderGroup, type LoaderStatus } from "@mileniumhq/paperui";

interface Step {
    label: string;
    subtitle?: Accessor<string | undefined>;
    percent: Accessor<number>;
    status: Accessor<LoaderStatus>;
}

export function InstallSteps(props: { steps: Step[] }) {
    return (
        <PaperLoaderGroup>
            <For each={props.steps}>
                {(step) => (
                    <PaperLoader
                        percent={step.percent()}
                        loaderStatus={step.status()}
                        label={step.label}
                        subtitle={step.subtitle?.()}
                    />
                )}
            </For>
        </PaperLoaderGroup>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
