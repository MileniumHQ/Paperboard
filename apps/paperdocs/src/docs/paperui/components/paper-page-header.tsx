import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperPageHeader,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperPageHeaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperPageHeader</PaperText>
            <PaperText preset="body">
                PaperPageHeader renders a standardized view header containing an icon chip, title, subtitle, and action buttons.
                Reach for PaperPageHeader at the top of tab bodies, tool panels, or documentation chapters.
                The header aligns flat against page backgrounds to maintain consistent depth with following content.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass title and subtitle props to label the view.
                Supply action buttons inside the children slot.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperPageHeader, PaperButton, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperPageHeader
                icon="terminal"
                title="Terminal"
                subtitle="Interactive shell session"
            >
                <PaperButton variant="primary">New session</PaperButton>
            </PaperPageHeader>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperPageHeader
                    icon="terminal"
                    title="Terminal"
                    subtitle="Interactive shell session"
                >
                    <PaperButton variant="primary">New session</PaperButton>
                </PaperPageHeader>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperPageHeader accepts the following configuration properties:
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
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td>No default</td>
                            <td>Primary page heading text.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>subtitle</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Secondary explanatory caption.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Icon glyph name or component rendered inside the leading framed chip.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperPageHeader places the icon chip and titles in a flex column or row depending on viewport width.
                Trailing action buttons align along the right margin.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Include secondary action buttons alongside the primary trigger.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPageHeader icon="settings" title="Configuration">
    <PaperButton>Reset</PaperButton>
    <PaperButton variant="primary">Save</PaperButton>
</PaperPageHeader>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperPageHeader icon="settings" title="Configuration">
                    <PaperButton>Reset</PaperButton>
                    <PaperButton variant="primary">Save</PaperButton>
                </PaperPageHeader>
            </PaperCard>
        </PaperFlex>
    );
}
