import {
    PaperBadge,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperMediaCard</PaperText>
            <PaperText preset="body">
                A composite surface card component incorporating a top media
                banner, an inset badge or avatar, structured typography, and
                actionable metadata footer slots.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperMediaCard</strong> is a high-level presentation
                component designed for content discovery, catalog browsing, and
                profile previews. It pairs a prominent visual banner with an
                overlapping icon badge, a title and description block, and
                customizable footer regions for secondary metadata and action
                triggers.
            </PaperText>
            <PaperText preset="body">
                Common applications include application stores, panel library
                catalogs, plugin explorers, world save selectors, and rich
                profile summary cards.
            </PaperText>

            <PaperSeparator />

            <PaperText id="basic-usage" preset="subheader">
                Basic usage
            </PaperText>
            <PaperText preset="body">
                At its simplest, <PaperCode>PaperMediaCard</PaperCode> renders a
                media banner, title, description, and metadata footer:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperMediaCard
    banner="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80"
    icon="view_compact"
    title="Application Title"
    subtitle="Category and Classification"
    description="A concise overview describing the primary features, capabilities, and operational parameters of the target resource."
    footerLeft={<PaperBadge variant="blue">v1.0.0</PaperBadge>}
    footerRight={<PaperText size={1} color="light-text">By Developer</PaperText>}
    onClick={() => {}}
/>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex
                    padding="full"
                    center
                    style={{ "max-width": "24em", margin: "0 auto" }}
                >
                    <PaperMediaCard
                        banner="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80"
                        icon="view_compact"
                        title="Application Title"
                        subtitle="Category and Classification"
                        description="A concise overview describing the primary features, capabilities, and operational parameters of the target resource."
                        footerLeft={
                            <PaperBadge variant="blue">v1.0.0</PaperBadge>
                        }
                        footerRight={
                            <PaperText size={1} color="light-text">
                                By Developer
                            </PaperText>
                        }
                        onClick={() => {}}
                    />
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
                        <td>
                            <PaperCode>banner</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Cover image URL or custom header element rendered at
                            the top of the card.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>bannerAlt</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>""</PaperCode>
                        </td>
                        <td>
                            Accessible description for the banner image when a
                            string URL is supplied.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>bannerHeight</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>calc(var(--paper-uigap) * 8)</PaperCode>
                        </td>
                        <td>
                            Sets the banner container height inline; when
                            omitted the CSS default of{" "}
                            <PaperCode>calc(var(--paper-uigap) * 8)</PaperCode>{" "}
                            applies.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>icon</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Floating avatar, image URL, or Material icon
                            overlapping the bottom-left of the banner.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>title</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <strong>Required</strong>
                        </td>
                        <td>Primary heading text or title element.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>subtitle</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Secondary text rendered below the primary title.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>description</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Body description with three-line truncation by
                            default.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>badge</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Status badge rendered in the upper-right corner of
                            the header.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>footerLeft</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Left-aligned metadata slot in the card footer (e.g.
                            badges, sizes, counts).
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>footerRight</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Right-aligned metadata slot in the card footer (e.g.
                            author name, action button).
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>children</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Content-area slot rendered between the description
                            and the footer, for arbitrary card body content.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>interactive</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>!disabled &amp;&amp; onClick present</PaperCode>
                        </td>
                        <td>
                            Enables hover elevation, cursor pointer styling, and
                            keyboard accessibility. Defaults to true only when
                            the card is not disabled and an onClick handler is
                            supplied.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>disabled</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>
                            Dims the card, blocks pointer events and click
                            handling, and suppresses interactive behavior even
                            when onClick is provided.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>effect</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>true</PaperCode>
                        </td>
                        <td>
                            Enables the PaperEffect ripple animation on click
                            when interactive.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onClick</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(e: MouseEvent) =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Click handler callback triggered on selection.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="card-groups" preset="subheader">
                Card groups
            </PaperText>
            <PaperText preset="body">
                <PaperCode>PaperMediaCardGroup</PaperCode> lays out cards in a
                responsive grid. Cards collectively take the full available
                width and wrap to the next row only when they would shrink
                below <PaperCode>minCardWidth</PaperCode>, so there is never
                awkward leftover space regardless of viewport size.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperMediaCardGroup minCardWidth="18rem">
    <PaperMediaCard
        icon="extension"
        title="First Panel"
        description="Rendered inside the responsive grid."
        onClick={() => {}}
    />
    <PaperMediaCard
        icon="extension"
        title="Second Panel"
        description="Wraps automatically on narrow viewports."
        onClick={() => {}}
    />
</PaperMediaCardGroup>`}
            </PaperCode>

            <PaperContainer>
                <PaperMediaCardGroup minCardWidth="14rem">
                    <PaperMediaCard
                        icon="view_compact"
                        title="Application Title"
                        subtitle="Category and Classification"
                        description="Cards share the full width of the group and wrap responsively."
                        onClick={() => {}}
                    />
                    <PaperMediaCard
                        icon="deployed_code"
                        title="Another Title"
                        subtitle="Category and Classification"
                        description="No fixed widths, no wasted space."
                        onClick={() => {}}
                    />
                    <PaperMediaCard
                        icon="extension"
                        title="Third Title"
                        subtitle="Category and Classification"
                        description="The grid reflows as the viewport changes."
                        onClick={() => {}}
                    />
                </PaperMediaCardGroup>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercontainer">
                        PaperContainer
                    </PaperLink>{" "}
                    — General-purpose rounded surface container.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink>{" "}
                    — Status badge component commonly placed in the header or
                    footer.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papereffect">
                        PaperEffect
                    </PaperLink>{" "}
                    — Interactive ripple and elevation layer embedded inside
                    cards.
                </PaperText>
            </PaperTextList>
        </>
    );
}
