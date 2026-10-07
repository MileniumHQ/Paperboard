import {
    PaperAvatar,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperAvatarDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperAvatar</PaperText>
            <PaperText preset="body">
                PaperAvatar renders an image avatar with an automatic icon fallback.
                Reach for PaperAvatar when displaying user profiles, bot identities, or application icons.
                An image avatar is drawn on a transparent background; the surface chip is reserved for the fallback glyph.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass an image URL via the src prop.
                When no image URL is provided, the component renders a fallback glyph on a surface chip.
                The chip is not drawn behind an image, so transparent avatars such as player heads blend with the surface beneath them.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperAvatar, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperAvatar fallbackIcon="person" size="medium" />
                <PaperAvatar fallbackIcon="terminal" size="medium" shape="square" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar fallbackIcon="person" size="medium" />
                    <PaperAvatar fallbackIcon="terminal" size="medium" shape="square" />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperAvatar accepts dimensions and shape configurations.
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
                            <td><PaperCode>src</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Image source URL. When absent, the component renders fallbackIcon.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>alt</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>""</PaperCode></td>
                            <td>Alternative text description for the rendered image.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>"small" | "medium" | "large" | "xlarge"</PaperCode></td>
                            <td><PaperCode>"medium"</PaperCode></td>
                            <td>Controls the height and width of the avatar container.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>shape</PaperCode></td>
                            <td><PaperCode>"circle" | "square"</PaperCode></td>
                            <td><PaperCode>"circle"</PaperCode></td>
                            <td>Sets the border radius to full circle or rounded tile.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fallbackIcon</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"person"</PaperCode></td>
                            <td>Material Symbols icon name rendered when src is absent.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperAvatar renders an HTML span containing either an img element or a PaperIcon component.
                The square shape matches application launcher tiles and plugin icons.
                The surface chip background is applied only when the fallback icon is shown, so an image with transparency does not sit on an opaque tile.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Display different sizes by setting the size prop.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperAvatar size="small" fallbackIcon="person" />
    <PaperAvatar size="medium" fallbackIcon="person" />
    <PaperAvatar size="large" fallbackIcon="person" />
    <PaperAvatar size="xlarge" fallbackIcon="person" />
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar size="small" fallbackIcon="person" />
                    <PaperAvatar size="medium" fallbackIcon="person" />
                    <PaperAvatar size="large" fallbackIcon="person" />
                    <PaperAvatar size="xlarge" fallbackIcon="person" />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
