import {
    PaperBadge,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperBadge</PaperText>
            <PaperText preset="body">
                <strong>PaperBadge</strong> is a compact graphical badge primitive used for categorical labeling, status indication, numeric counts, and metadata tagging.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperBadge is an inline status and annotation component in PaperUI. It pairs chromatic background fills with rounded borders, optional iconography, and short text labels. Badges are commonly placed next to titles, table cells, list items, and summary cards to communicate operational state or categorization.
            </PaperText>

            <PaperSeparator />

            <PaperText id="color-variants" preset="subheader">
                Color Variants
            </PaperText>
            <PaperText preset="body">
                The component provides five semantic color variants configured via the <PaperCode>variant</PaperCode> prop:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variant</th>
                        <th>Semantic Connotation</th>
                        <th>Standard Application</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"monochrome"</PaperCode></td>
                        <td>Neutral / Default</td>
                        <td>Version identifiers, neutral counts, inactive states.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"blue"</PaperCode></td>
                        <td>Informative / In-Progress</td>
                        <td>Active reviews, ongoing synchronizations, informational tags.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"green"</PaperCode></td>
                        <td>Success / Operational</td>
                        <td>Completed builds, approved reviews, healthy services.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"yellow"</PaperCode></td>
                        <td>Warning / Cautionary</td>
                        <td>Approaching resource quotas, pending migrations, non-fatal warnings.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"red"</PaperCode></td>
                        <td>Critical / Failed</td>
                        <td>Broken builds, permission rejections, failed deployment pipelines.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="half">
    <PaperBadge variant="monochrome">v1.4.0</PaperBadge>
    <PaperBadge variant="blue">In Review</PaperBadge>
    <PaperBadge variant="green">Healthy</PaperBadge>
    <PaperBadge variant="yellow">Attention</PaperBadge>
    <PaperBadge variant="red">Failed</PaperBadge>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half" wrap>
                    <PaperBadge variant="monochrome">v1.4.0</PaperBadge>
                    <PaperBadge variant="blue">In Review</PaperBadge>
                    <PaperBadge variant="green">Healthy</PaperBadge>
                    <PaperBadge variant="yellow">Attention</PaperBadge>
                    <PaperBadge variant="red">Failed</PaperBadge>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="icon-integration" preset="subheader">
                Icon integration
            </PaperText>
            <PaperText preset="body">
                Badges accept leading icons via the <PaperCode>icon</PaperCode> prop. The value may be supplied either as a string corresponding to a Material Symbol glyph name or as an instantiated <PaperLink href="/paperui/papericon"><PaperCode>PaperIcon</PaperCode></PaperLink> element:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperBadge variant="green" icon="check_circle">Verified</PaperBadge>
<PaperBadge variant="blue" icon="sync">Syncing</PaperBadge>
<PaperBadge variant="red" icon="error">Error Detected</PaperBadge>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half" wrap>
                    <PaperBadge variant="green" icon="check_circle">Verified</PaperBadge>
                    <PaperBadge variant="blue" icon="sync">Syncing</PaperBadge>
                    <PaperBadge variant="red" icon="error">Error Detected</PaperBadge>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
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
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>"monochrome" | "blue" | "green" | "yellow" | "red"</PaperCode></td>
                        <td><PaperCode>"monochrome"</PaperCode></td>
                        <td>Visual color scheme and theme variant of the badge container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Material icon identifier string or PaperIcon element rendered before the label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Badge text content or child elements.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom CSS class name applied to the badge container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>classList</PaperCode></td>
                        <td><PaperCode>Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Conditional class name mapping.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papericon">PaperIcon</PaperLink> — Icon rendering component embedded inside badges.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbutton">PaperButton</PaperLink> — Interactive button primitive sharing color variant conventions.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/colors">Colors</PaperLink> — Design system color token specification.
                </PaperText>
            </PaperTextList>
        </>
    );
}
