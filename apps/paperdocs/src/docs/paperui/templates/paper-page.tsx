import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperPage,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperPageDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperPage</PaperText>
            <PaperText preset="body">
                PaperPage establishes a centered content column with readable width limits and tokenized padding.
                Reach for PaperPage when structuring document pages, settings views, or articles inside panel tabs.
                The template centers content horizontally while maintaining standard gutter spacing.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap view sections inside PaperPage.
                Choose between standard, wide, and full column width presets.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperPage, PaperCard, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="none" surface="back">
            <PaperPage width="standard" padding="double">
                <PaperCard padding="double" surface="front">
                    <PaperText preset="title">Standard column</PaperText>
                    <PaperText color="text-subtle">
                        Content is bounded to 992px to optimize readability.
                    </PaperText>
                </PaperCard>
            </PaperPage>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="none" surface="back">
                <PaperPage width="standard" padding="double">
                    <PaperCard padding="double" surface="front">
                        <PaperText preset="title">Standard column</PaperText>
                        <PaperText color="text-subtle">
                            Content is bounded to 992px to optimize readability.
                        </PaperText>
                    </PaperCard>
                </PaperPage>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperPage accepts width boundaries and spacing configurations:
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
                            <td><PaperCode>width</PaperCode></td>
                            <td><PaperCode>"standard" | "wide" | "full"</PaperCode></td>
                            <td><PaperCode>"standard"</PaperCode></td>
                            <td>Maximum width bound: standard (992px), wide (1400px), or full (100%).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>padding</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>"full"</PaperCode></td>
                            <td>Internal padding using token sizes: none, half, full, double, triple.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>gap</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>"full"</PaperCode></td>
                            <td>Vertical gap between child sections.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperPage applies auto horizontal margins to center the column within wide viewports.
                The layout automatically expands to 100% width on mobile screens below the width threshold.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use the wide preset when presenting multi-column card dashboards.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPage width="wide">
    <PaperText preset="title">Dashboard</PaperText>
</PaperPage>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperPage width="wide">
                    <PaperText preset="title">Dashboard</PaperText>
                </PaperPage>
            </PaperCard>
        </PaperFlex>
    );
}
