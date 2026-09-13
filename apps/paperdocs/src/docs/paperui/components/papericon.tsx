import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperIcon</PaperText>
            <PaperText preset="body">
                <strong>PaperIcon</strong> is a standardized iconography primitive rendering Google Material Symbols Rounded glyphs, image assets, monogram chips, and inline alignment helpers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperIcon provides vector iconography and image emblem rendering across PaperUI. It integrates the Material Symbols Rounded font family and includes alignment modifiers such as <PaperCode>zeroHeight</PaperCode> for embedding inside button labels without perturbing baseline typography.
            </PaperText>

            <PaperSeparator />

            <PaperText id="glyph-icons" preset="subheader">
                Material glyph rendering
            </PaperText>
            <PaperText preset="body">
                Glyphs are rendered by supplying the icon identifier string as the component child:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="full" align="center">
    <PaperIcon>home</PaperIcon>
    <PaperIcon>search</PaperIcon>
    <PaperIcon>settings</PaperIcon>
    <PaperIcon>favorite</PaperIcon>
    <PaperIcon>bolt</PaperIcon>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="full">
                    <PaperIcon>home</PaperIcon>
                    <PaperIcon>search</PaperIcon>
                    <PaperIcon>settings</PaperIcon>
                    <PaperIcon>favorite</PaperIcon>
                    <PaperIcon>bolt</PaperIcon>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="image-and-monogram" preset="subheader">
                Images and monograms
            </PaperText>
            <PaperText preset="body">
                Specifying the <PaperCode>src</PaperCode> prop renders an internal <PaperCode>&lt;img&gt;</PaperCode> element. The <PaperCode>monogram</PaperCode> prop enables a rounded circular badge style:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="full" align="center">
    <PaperIcon monogram>PB</PaperIcon>
    <PaperIcon src="/paperui.png" alt="PaperUI Logo" />
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="full">
                    <PaperIcon monogram>PB</PaperIcon>
                    <PaperIcon src="/paperui.png" alt="PaperUI Logo" />
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="zero-height" preset="subheader">
                Inline alignment (<PaperCode>zeroHeight</PaperCode>)
            </PaperText>
            <PaperText preset="body">
                When icons are placed inside buttons or body text, default font line-heights can introduce vertical offset. The <PaperCode>zeroHeight</PaperCode> modifier collapses the element height to the surrounding text size so the glyph sits on the text baseline.
            </PaperText>

            <PaperSeparator />

            <PaperText id="sizing" preset="subheader">
                Sizing and rendering
            </PaperText>
            <PaperText preset="body">
                PaperIcon renders as an inline-flex <PaperCode>&lt;span&gt;</PaperCode> sized to 1 em; there is no built-in size system. Icon dimensions follow the inherited <PaperCode>font-size</PaperCode> of the surrounding context, and glyphs are drawn with the Material Symbols variation settings <PaperCode>"FILL" 1</PaperCode>, <PaperCode>"wght" 500</PaperCode>, <PaperCode>"GRAD" 0</PaperCode>, and <PaperCode>"opsz" 14</PaperCode>. Image assets set via <PaperCode>src</PaperCode> are likewise constrained to a 1 em square with contained object fit.
            </PaperText>

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
                        <td><PaperCode>zeroHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Collapses element line-height for vertical alignment inside buttons and text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>monogram</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Formats icon as a circular background monogram badge.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Image source URL for rendering raster or external SVG icon assets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>alt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>""</PaperCode></td>
                        <td>Accessibility alternative text for image-based icons.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Material Symbols glyph identifier name or custom child elements.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbutton">PaperButton</PaperLink> — Button primitive utilizing PaperIcon.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Status badge component supporting icon props.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperrail">PaperRail</PaperLink> — Navigation rail based on PaperIcon items.
                </PaperText>
            </PaperTextList>
        </>
    );
}
