import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperProse,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperProseDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperProse</PaperText>
            <PaperText preset="body">
                PaperProse applies standardized typography rules, headings, list formats, and code styling to rendered markdown content.
                Reach for PaperProse when displaying parsed README files, blog bodies, release notes, or sanitized HTML articles.
                The wrapper guarantees proper line-lengths, heading margins, and blockquote borders without custom CSS rules.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place rendered rich text or markdown HTML elements inside PaperProse.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperProse, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperProse>
                <h3>Release overview</h3>
                <p>This release improves performance and adds structured event streaming.</p>
                <ul>
                    <li>First bullet item</li>
                    <li>Second bullet item</li>
                </ul>
            </PaperProse>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperProse>
                    <h3>Release overview</h3>
                    <p>This release improves performance and adds structured event streaming.</p>
                    <ul>
                        <li>First bullet item</li>
                        <li>Second bullet item</li>
                    </ul>
                </PaperProse>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperProse accepts standard HTML div container attributes:
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
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>HTML tags and formatted prose text.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperProse formats h1 through h6 tags, blockquotes, code blocks, lists, and tables.
                All descendant elements inherit font colors and metrics from PaperUI tokens.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render sanitized HTML strings directly into PaperProse using innerHTML.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperProse innerHTML="<p>Formatted text body</p>" />`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperProse innerHTML="<p>Formatted text body</p>" />
            </PaperCard>
        </PaperFlex>
    );
}
