import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperButtonDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperButton</PaperText>
            <PaperText preset="body">
                PaperButton triggers an action, submits a form, or renders an anchor styled as a button.
                Reach for PaperButton when initiating primary actions, secondary interactions, or icon tool triggers.
                The button exposes semantic color variants, four discrete sizes, and square icon styling.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Render PaperButton with text children or an icon.
                Pass variant and size props to adapt visual weight.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperButton>Button</PaperButton>
                <PaperButton variant="primary">Primary</PaperButton>
                <PaperButton variant="danger">Danger</PaperButton>
                <PaperButton disabled>Disabled</PaperButton>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperButton>Button</PaperButton>
                    <PaperButton variant="primary">Primary</PaperButton>
                    <PaperButton variant="danger">Danger</PaperButton>
                    <PaperButton disabled>Disabled</PaperButton>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperButton accepts the following configuration props:
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
                        <td><PaperCode>PaperButtonVariant</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Semantic role or "text" for borderless low-emphasis actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>"tiny" | "small" | "medium" | "large"</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td>Control dimensions and typography size.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>When true, formats the button as a square icon button without horizontal text padding.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>When set, renders an anchor element instead of a button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Disables pointer events and lowers opacity.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"button" | "submit" | "reset"</PaperCode></td>
                        <td><PaperCode>"button"</PaperCode></td>
                        <td>Standard HTML button behavior type. Ignored when href is set.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="tactile-effects">Tactile effects</PaperText>
            <PaperText preset="body">
                Wrap PaperButton inside PaperEffect to add a solid offset shadow and push-down press animations.
                PaperEffect coordinates hover lift and active press depression matching the button color role.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperEffect, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function EffectExample() {
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

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When href is provided, the component renders an anchor tag and omits button-specific attributes.
                Square icon buttons apply an accessible aria-label using string children if no aria-label prop is set.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Combine sizes and icon formatting for toolbar buttons.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperButton size="tiny" icon title="Delete">
        <PaperIcon zeroHeight>delete</PaperIcon>
    </PaperButton>
    <PaperButton size="small">Small</PaperButton>
    <PaperButton size="medium">Medium</PaperButton>
    <PaperButton size="large">Large</PaperButton>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperButton size="tiny" icon title="Delete">
                        <PaperIcon zeroHeight>delete</PaperIcon>
                    </PaperButton>
                    <PaperButton size="small">Small</PaperButton>
                    <PaperButton size="medium">Medium</PaperButton>
                    <PaperButton size="large">Large</PaperButton>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
