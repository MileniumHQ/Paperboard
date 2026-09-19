import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEmptyState,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperEmptyStateDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperEmptyState</PaperText>
            <PaperText preset="body">
                PaperEmptyState displays a centered placeholder with an icon, title, description, and action buttons.
                Reach for PaperEmptyState when a list has no entries, a search query returns no results, or initial setup is required.
                The layout keeps empty views centered and balanced across viewports.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass icon, title, and description props to communicate the current state.
                Render recovery action buttons inside the children slot.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperEmptyState, PaperButton, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperEmptyState
                icon="inbox"
                title="No messages"
                description="New notifications will appear here when received."
            >
                <PaperButton variant="primary">Refresh</PaperButton>
            </PaperEmptyState>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperEmptyState
                    icon="inbox"
                    title="No messages"
                    description="New notifications will appear here when received."
                >
                    <PaperButton variant="primary">Refresh</PaperButton>
                </PaperEmptyState>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperEmptyState accepts the following properties:
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
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Material Symbols icon name or custom element displayed at the top.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Primary summary heading.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>description</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Explanatory text providing guidance or next steps.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperEmptyState aligns all child content along a centered vertical axis.
                Children are placed inside an actions flex row with standard gap spacing.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render search empty states when filter queries return zero results.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperEmptyState
    icon="search_off"
    title="No results found"
    description="Adjust your search terms to find matching items."
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperEmptyState
                    icon="search_off"
                    title="No results found"
                    description="Adjust your search terms to find matching items."
                />
            </PaperCard>
        </PaperFlex>
    );
}
