import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSplit,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperSplitDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSplit</PaperText>
            <PaperText preset="body">
                PaperSplit lays out a master-detail view: a fixed side pane beside a fluid detail pane.
                Reach for PaperSplit when browsing a roster of entities and inspecting the selected one.
                The layout collapses on its own when the container gets too narrow for both panes.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the list as side and the inspector as children. Set detailActive when a selection exists.
                At wide sizes the panes sit side by side; below the collapse width the side fills the space and the detail presents as a modal.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSplit, PaperCard, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperSplit
            side={<PaperCard fullHeight padding="full"><PaperText>Roster</PaperText></PaperCard>}
            detailActive={selected() !== undefined}
            onDetailClose={() => setSelected(undefined)}
            detailTitle={selected()?.name}
        >
            <PaperCard fullHeight padding="full"><PaperText>Inspector</PaperText></PaperCard>
        </PaperSplit>
    );
}`}
            </PaperCode>

            <PaperCard style={{ height: "320px" }}>
                <PaperFlex fullHeight fullWidth padding="full">
                    <PaperSplit
                        side={
                            <PaperCard fullHeight padding="full">
                                <PaperText weight={600}>Roster</PaperText>
                                <PaperText color="text-subtle">Select a player to inspect.</PaperText>
                            </PaperCard>
                        }
                        detailActive={true}
                        detailTitle="Detail"
                    >
                        <PaperCard fullHeight padding="full">
                            <PaperText weight={600}>Inspector</PaperText>
                            <PaperText color="text-subtle">Stats, permissions, and moderation.</PaperText>
                        </PaperCard>
                    </PaperSplit>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSplit accepts pane content and collapse properties:
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
                            <td><PaperCode>side</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>The list or roster pane held at a fixed width.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>The detail pane shown beside the side, or as a modal when collapsed.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>sideWidth</PaperCode></td>
                            <td><PaperCode>number | string</PaperCode></td>
                            <td><PaperCode>--paper-size-split-side</PaperCode></td>
                            <td>Side pane width. A number is px; a string is used verbatim.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>collapseWidth</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>680</PaperCode></td>
                            <td>Container width in px below which the panes collapse to one.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>detailActive</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>When collapsed, opens the detail as a modal over the side pane.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onDetailClose</PaperCode></td>
                            <td><PaperCode>() =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Called when the collapsed detail modal is dismissed.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>detailTitle</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Title shown in the collapsed detail modal header.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperSplit measures its own width with a ResizeObserver; the panel writes no media queries.
                Below collapseWidth the side pane fills the space and the detail renders in a PaperModal, so the view stays usable at Paperboard's minimum window size.
                The collapsed modal traps focus and closes on Escape and backdrop click through PaperModal.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Bind detailActive to the selected entity so selecting a row opens the modal on small widths.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperSplit
    side={<PlayerList selected={openPlayer()} onSelect={setOpenPlayer} />}
    detailActive={openPlayer() !== undefined}
    onDetailClose={() => setOpenPlayer(undefined)}
    detailTitle={openPlayer()?.name}
>
    <PlayerInspector player={openPlayer()} />
</PaperSplit>`}
            </PaperCode>
        </PaperFlex>
    );
}
