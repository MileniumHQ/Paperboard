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
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperIcon</PaperText>
            <PaperText preset="body">
                A standardized iconography primitive rendering Google Material Symbols Rounded glyphs, image assets, monogram chips, and inline alignment helpers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperIcon</strong> provides vector iconography and image emblem rendering across PaperUI. It integrates the Material Symbols Rounded font family, enforces standard dimension bounding boxes (small, medium, large, huge), and includes alignment modifiers such as <PaperCode>zeroHeight</PaperCode> for embedding inside button labels without perturbing baseline typography.
            </PaperText>

            <PaperSeparator />

            <PaperText id="glyph-icons" preset="subheader">
                Material Glyph Rendering
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
                Images and Monograms
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
                Inline Alignment (<PaperCode>zeroHeight</PaperCode>)
            </PaperText>
            <PaperText preset="body">
                When icons are placed inside buttons or body text, default font line-heights can introduce vertical offset errors. The <PaperCode>zeroHeight</PaperCode> modifier removes extraneous bounding box height to align perfectly with text baselines.
            </PaperText>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
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
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbutton">PaperButton</PaperLink> — Button primitive utilizing PaperIcon.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Status badge component supporting icon properties.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperrail">PaperRail</PaperLink> — Navigation rail based on PaperIcon items.
                </PaperText>
            </PaperTextList>
        </>
    );
}
