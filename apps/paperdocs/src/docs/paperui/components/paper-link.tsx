import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperLinkDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperLink</PaperText>
            <PaperText preset="body">
                PaperLink renders styled anchor hyperlinks with automatic external target handling and indicator icons.
                Reach for PaperLink when navigating between documentation pages or linking to external developer sites.
                The component displays an external arrow indicator when linking outside the current domain.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass destination URLs to the href prop.
                External links automatically open in a new tab with noopener security attributes.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperLink, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="double" align="center">
                <PaperLink href="/paperui/overview">Documentation</PaperLink>
                <PaperLink href="https://paperboard.dev" external>Official website</PaperLink>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center">
                    <PaperLink href="/paperui/overview">Documentation</PaperLink>
                    <PaperLink href="https://paperboard.dev" external>Official website</PaperLink>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperLink accepts standard anchor attributes plus external detection:
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
                            <td><PaperCode>href</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td>No default</td>
                            <td>Destination URL.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>external</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>Boolean(href?.startsWith("http"))</PaperCode></td>
                            <td>Forces external link treatment with open_in_new icon and _blank target.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When external is active, target defaults to _blank and rel defaults to noopener noreferrer.
                The trailing icon renders with zero height to preserve font baseline alignment.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Place links within text paragraphs without breaking line flow.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperText preset="body">
    Visit the <PaperLink href="https://github.com/paperboard-dev">repository</PaperLink> for details.
</PaperText>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperText preset="body">
                    Visit the <PaperLink href="https://github.com/paperboard-dev">repository</PaperLink> for details.
                </PaperText>
            </PaperCard>
        </PaperFlex>
    );
}
