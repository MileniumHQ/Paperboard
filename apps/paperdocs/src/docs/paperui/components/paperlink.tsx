import {
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
            <PaperText preset="header">PaperLink</PaperText>
            <PaperText preset="body">
                <strong>PaperLink</strong> is an accessible hyperlink navigation primitive featuring automatic external destination detection, security attribute injection, and trailing external icon indicators.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperLink wraps the HTML <PaperCode>&lt;a&gt;</PaperCode> anchor tag. It styles links with PaperUI brand accent colors (<PaperCode>--paper-front-blue</PaperCode>), subtle hover underlines, and automatic external URL processing.
            </PaperText>

            <PaperSeparator />

            <PaperText id="external-detection" preset="subheader">
                External link handling
            </PaperText>
            <PaperText preset="body">
                When the <PaperCode>href</PaperCode> begins with <PaperCode>http</PaperCode> (or when the <PaperCode>external</PaperCode> prop is explicitly set to <PaperCode>true</PaperCode>), <PaperCode>PaperLink</PaperCode> automatically appends <PaperCode>target="_blank"</PaperCode>, sets <PaperCode>rel="noopener noreferrer"</PaperCode> to mitigate tab-nabbing security risks, and renders a trailing <PaperCode>open_in_new</PaperCode> Material glyph:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex gap="half">
    <PaperLink href="/paperui/quick-start">
        Internal Documentation Link
    </PaperLink>

    <PaperLink href="https://docs.solidjs.com/" external>
        External SolidJS Documentation
    </PaperLink>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center gap="half">
                    <PaperLink href="/paperui/quick-start">
                        Internal Documentation Link
                    </PaperLink>
                    <PaperLink href="https://docs.solidjs.com/" external>
                        External SolidJS Documentation
                    </PaperLink>
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
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Destination URL or routing path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>external</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>auto (href.startsWith("http"))</PaperCode></td>
                        <td>Forces external link security attributes and external icon rendering.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"_blank" (if external)</PaperCode></td>
                        <td>HTML anchor target frame attribute.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"noopener noreferrer" (if external)</PaperCode></td>
                        <td>Relationship attribute for security and referrer management.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Anchor label text or nested elements.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbutton">PaperButton</PaperLink> — Clickable action button primitive.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertext">PaperText</PaperLink> — Typography primitive.
                </PaperText>
            </PaperTextList>
        </>
    );
}
