import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEffect,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperEffectDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperEffect</PaperText>
            <PaperText preset="body">
                PaperEffect wraps an interactive element with a solid offset shadow that elevates on hover and depresses on press.
                Reach for PaperEffect when wrapping buttons, custom cards, or selector items that require push-down tactile feedback.
                The wrapper positions a pseudo-element shadow layer using the component role color or border tone.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap buttons or interactive tiles in PaperEffect.
                Pass a semantic role variant to color the offset shadow, or pass colorless for a border-toned shadow.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperEffect, PaperButton, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperEffect variant="primary">
                    <PaperButton variant="primary">Primary effect</PaperButton>
                </PaperEffect>
                <PaperEffect colorless>
                    <PaperButton>Colorless effect</PaperButton>
                </PaperEffect>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperEffect variant="primary">
                        <PaperButton variant="primary">Primary effect</PaperButton>
                    </PaperEffect>
                    <PaperEffect colorless>
                        <PaperButton>Colorless effect</PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperEffect accepts the following configuration properties:
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
                        <td><PaperCode>colorless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Forces the shadow layer to use var(--paper-border-strong) instead of a color role.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Semantic role used to derive the deep shadow tone (such as var(--paper-primary-deep)).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Disables hover and active transforms and switches cursor to default.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                A pseudo-element shadow is positioned at an offset of var(--paper-uigap-onefourth) down and to the right.
                Hovering shifts the container up and left by 1px, expanding the exposed shadow depth.
                Pressing down shifts the container down and right by 3px, collapsing the element into the shadow.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Wrap cards to provide physical push-button feedback when clicked.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperEffect variant="success">
    <PaperCard padding="double" surface="front">
        <PaperText preset="body" weight={600}>Pressable card</PaperText>
    </PaperCard>
</PaperEffect>`}
            </PaperCode>
            <PaperCard padding="double" surface="back">
                <PaperEffect variant="success">
                    <PaperCard padding="double" surface="front">
                        <PaperText preset="body" weight={600}>Pressable card</PaperText>
                    </PaperCard>
                </PaperEffect>
            </PaperCard>
        </PaperFlex>
    );
}
