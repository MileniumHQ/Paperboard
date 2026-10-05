import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLoader,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperLoaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperLoader</PaperText>
            <PaperText preset="body">
                PaperLoader renders a circular progress indicator displaying percentage completion, indeterminate spinning, or terminal statuses.
                Reach for PaperLoader when waiting on network requests, background downloads, or packaging operations.
                The indicator displays smooth transitions between progress arcs and terminal completion marks.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Set loaderStatus to "loading" with a percent number, or use "indeterminate" when duration is unknown.
                Provide an optional label to explain the current background task.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperLoader, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="double" align="center">
                <PaperLoader loaderStatus="loading" percent={65} label="65%" />
                <PaperLoader loaderStatus="indeterminate" label="Syncing" />
                <PaperLoader loaderStatus="success" label="Complete" />
                <PaperLoader loaderStatus="error" label="Failed" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center">
                    <PaperLoader loaderStatus="loading" percent={65} label="65%" />
                    <PaperLoader loaderStatus="indeterminate" label="Syncing" />
                    <PaperLoader loaderStatus="success" label="Complete" />
                    <PaperLoader loaderStatus="error" label="Failed" />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperLoader accepts the following configuration properties:
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
                            <td><PaperCode>loaderStatus</PaperCode></td>
                            <td><PaperCode>"loading" | "indeterminate" | "success" | "error" | "waiting"</PaperCode></td>
                            <td>No default</td>
                            <td>Current lifecycle state of the loader indicator.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>percent</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>0</PaperCode></td>
                            <td>Completion percentage between 0 and 100 for determinate progress.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>"small" | "medium" | "large"</PaperCode></td>
                            <td><PaperCode>"medium"</PaperCode></td>
                            <td>Diameter size preset for the circular track.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Status caption rendered next to the indicator.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Determinate and indeterminate states use distinct SVG path definitions to prevent rotation snapping during state changes.
                Terminal states ("success" and "error") fill the circle and display status colors.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use the small size variant within table cells and dense list rows.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperLoader size="small" loaderStatus="indeterminate" label="Checking" />`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperLoader size="small" loaderStatus="indeterminate" label="Checking" />
            </PaperCard>
        </PaperFlex>
    );
}
