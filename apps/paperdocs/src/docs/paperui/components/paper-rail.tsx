import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperRail,
    PaperRailAction,
    PaperRailItem,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperRailDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperRail</PaperText>
            <PaperText preset="body">
                PaperRail provides a compact icon navigation rail for switching primary view modes in dense layouts.
                Reach for PaperRail when building compact vertical toolbars or workspace view selectors.
                The rail supports icon-only presentations, compact labels, and standalone action triggers.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Assemble navigation destinations using PaperRailItem and standalone buttons with PaperRailAction.
                Manage the active destination using value and onValueChange props.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperRail, PaperRailItem, PaperRailAction, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
                <PaperRail name="nav-rail" defaultValue="files" showLabels>
                <PaperRailItem value="files" icon="folder" label="Files" />
                <PaperRailItem value="terminal" icon="terminal" label="Terminal" />
                <PaperRailAction icon="settings" label="Settings" />
            </PaperRail>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
            <PaperRail name="nav-rail" defaultValue="files" showLabels>
                    <PaperRailItem value="files" icon="folder" label="Files" />
                    <PaperRailItem value="terminal" icon="terminal" label="Terminal" />
                    <PaperRailAction icon="settings" label="Settings" />
                </PaperRail>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperRail accepts the following configuration properties:
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
                            <td><PaperCode>name</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td>No default</td>
                            <td>Form group name identifying the radio selection context.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Currently active selected destination value.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Initial selected destination for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>showLabels</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Displays text labels beneath icons across rail items.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperRailItem elements use role="radio" with aria-checked bindings for accessibility.
                Pressing Space or Enter activates the focused destination.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Omit showLabels for an ultra-compact icon strip.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperRail name="home-rail" defaultValue="home">
    <PaperRailItem value="home" icon="home" label="Home" />
    <PaperRailItem value="search" icon="search" label="Search" />
</PaperRail>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperRail name="home-rail" defaultValue="home">
                    <PaperRailItem value="home" icon="home" label="Home" />
                    <PaperRailItem value="search" icon="search" label="Search" />
                </PaperRail>
            </PaperCard>
        </PaperFlex>
    );
}
