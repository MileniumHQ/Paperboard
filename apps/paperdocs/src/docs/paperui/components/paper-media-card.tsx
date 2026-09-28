import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperMediaCardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperMediaCard</PaperText>
            <PaperText preset="body">
                PaperMediaCard presents an application tile with optional banner images, icons, descriptive text, and actions.
                Reach for PaperMediaCard when building panel catalogs, store listings, game servers, or media dashboards.
                The card supports interactive hover elevation, badge chips, and responsive card grids.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Specify title, description, and icon props to construct an application card.
                Add action buttons in the footerLeft or footerRight slots.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMediaCard, PaperBadge, PaperButton, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="back">
            <PaperMediaCard
                icon="terminal"
                title="Terminal"
                subtitle="v3.0.0"
                description="Interactive shell and multi-tab console."
                badge={<PaperBadge variant="success">Installed</PaperBadge>}
                footerRight={<PaperButton size="small" variant="primary">Launch</PaperButton>}
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="back">
                <PaperMediaCard
                    icon="terminal"
                    title="Terminal"
                    subtitle="v3.0.0"
                    description="Interactive shell and multi-tab console."
                    badge={<PaperBadge variant="success">Installed</PaperBadge>}
                    footerRight={<PaperButton size="small" variant="primary">Launch</PaperButton>}
                />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperMediaCard accepts the following configuration properties:
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
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>Primary header text.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>subtitle</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Secondary metadata line rendered under the title.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>description</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Body explanation text, clamped to three lines.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>descriptionExtra</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Content below the description, outside its line clamp and pinned to the card's bottom edge so cards in a row align. Use it for meters or status rows.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Icon ligature name or image URL.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>banner</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Header graphic banner URL or custom component.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>badge</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Corner status badge chip.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>footerLeft</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Content placed in the bottom-left corner of the card.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>footerRight</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Actions placed in the bottom-right corner of the card.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When onClick or href is passed, the card wraps itself in PaperEffect and activates interactive hover styling.
                Keyboard navigation triggers onClick when pressing Enter or Space.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Arrange cards in a responsive catalog using PaperMediaCardGroup.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCardGroup minCardWidth="220px">
    <PaperMediaCard icon="extension" title="Extension 1" />
    <PaperMediaCard icon="extension" title="Extension 2" />
</PaperMediaCardGroup>`}
            </PaperCode>
            <PaperCard padding="double" surface="back">
                <PaperMediaCardGroup minCardWidth="220px">
                    <PaperMediaCard icon="extension" title="Extension 1" />
                    <PaperMediaCard icon="extension" title="Extension 2" />
                </PaperMediaCardGroup>
            </PaperCard>
        </PaperFlex>
    );
}
