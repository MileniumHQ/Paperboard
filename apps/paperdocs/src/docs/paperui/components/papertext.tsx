import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperText</PaperText>
            <PaperText preset="body">
                <strong>PaperText</strong> is a polymorphic typography primitive providing systematic size and weight presets, rounded typeface switching, and automatic anchor link copying.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperText</strong> is the primary typographical component in PaperUI. It maps sizing values to the <PaperCode>--paper-text-size-*</PaperCode> scale, supports polymorphic HTML rendering (via the <PaperCode>as</PaperCode> prop), renders rounded headings via <PaperCode>rounded</PaperCode>, and automatically generates an interactive anchor link copy button when an <PaperCode>id</PaperCode> is declared.
            </PaperText>

            <PaperSeparator />

            <PaperText id="presets" preset="subheader">
                Typographic Presets
            </PaperText>
            <PaperText preset="body">
                The component bundles standardized size and font-weight pairings into convenient preset strings:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex gap="half">
    <PaperText preset="header">Header Preset (34px, 700)</PaperText>
    <PaperText preset="subheader">Subheader Preset (24px, 600)</PaperText>
    <PaperText preset="title">Title Preset (20px, 700)</PaperText>
    <PaperText preset="subtitle">Subtitle Preset (16px, 500)</PaperText>
    <PaperText preset="body">Body Preset (16px, 400)</PaperText>
    <PaperText preset="caption">Caption Preset (12px, 500)</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <PaperText preset="header">Header Preset (34px, 700)</PaperText>
                    <PaperText preset="subheader">Subheader Preset (24px, 600)</PaperText>
                    <PaperText preset="title">Title Preset (20px, 700)</PaperText>
                    <PaperText preset="subtitle">Subtitle Preset (16px, 500)</PaperText>
                    <PaperText preset="body">Body Preset (16px, 400)</PaperText>
                    <PaperText preset="caption">Caption Preset (12px, 500)</PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="rounded-and-anchor" preset="subheader">
                Rounded Font & Anchor Generation
            </PaperText>
            <PaperText preset="body">
                Specifying <PaperCode>rounded</PaperCode> applies the <strong>Nunito</strong> rounded typeface. Supplying an <PaperCode>id</PaperCode> automatically appends a subtle anchor link button:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperText id="demo-section-anchor" preset="title" rounded>
    Section with Copyable Anchor Link
</PaperText>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperText id="demo-section-anchor" preset="title" rounded>
                        Section with Copyable Anchor Link
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

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
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>"headline" | "header" | "subheader" | "title" | "subtitle" | "section" | "body" | "caption"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Preconfigured font size and weight pairing preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number (0–17)</PaperCode></td>
                        <td><PaperCode>4 (18px)</PaperCode></td>
                        <td>Direct index into the <PaperCode>--paper-text-size-*</PaperCode> scale.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>weight</PaperCode></td>
                        <td><PaperCode>number (100–900)</PaperCode></td>
                        <td><PaperCode>400</PaperCode></td>
                        <td>Numeric font-weight declaration.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rounded</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Applies the Nunito rounded display font family.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>as</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"span"</PaperCode></td>
                        <td>HTML tag name rendered dynamically (e.g. <PaperCode>"h1"</PaperCode>, <PaperCode>"p"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Text color token name (e.g. <PaperCode>"light-text"</PaperCode>), CSS variable, or hex/rgb color string.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Element identifier that triggers automatic anchor button creation.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/typography">Typography & Fonts</PaperLink> — Comprehensive type scale and font token reference.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertextlist">PaperTextList</PaperLink> — List formatting component for typography.
                </PaperText>
            </PaperTextList>
        </>
    );
}
