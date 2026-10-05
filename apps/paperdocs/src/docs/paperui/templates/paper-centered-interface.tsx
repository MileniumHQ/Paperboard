import {
    PaperButton,
    PaperCard,
    PaperCenteredInterface,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperCenteredInterfaceDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperCenteredInterface</PaperText>
            <PaperText preset="body">
                PaperCenteredInterface centers a fixed or responsive interface box within its viewport container.
                Reach for PaperCenteredInterface when building login dialogs, onboarding screens, or setup wizards.
                The template constrains dimensions using standard size presets or custom width bounds.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap centered views inside PaperCenteredInterface.
                Specify a size preset or direct width to control maximum layout boundaries.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCenteredInterface, PaperCard, PaperFlex, PaperText, PaperButton } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="back">
            <PaperCenteredInterface preset="small">
                <PaperCard padding="double" surface="front">
                    <PaperFlex direction="column" gap="full">
                        <PaperText preset="title">Centered view</PaperText>
                        <PaperButton variant="primary">Proceed</PaperButton>
                    </PaperFlex>
                </PaperCard>
            </PaperCenteredInterface>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="back">
                <PaperCenteredInterface preset="small">
                    <PaperCard padding="double" surface="front">
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="title">Centered view</PaperText>
                            <PaperButton variant="primary">Proceed</PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </PaperCenteredInterface>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperCenteredInterface supports preset dimensions and dimension overrides:
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
                            <td><PaperCode>"small" | "compact" | "medium" | "large" | "wide" | "full" | "fullscreen" | "auto" | "fit"</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Standard sizing preset defining maximum width and height metrics.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>PaperCenteredInterfacePreset</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Alias for the preset prop.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>width</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Explicit width string overriding preset width.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>height</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Explicit height string overriding preset height.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The outer element uses flexbox alignment with centered horizontal and vertical axes.
                The inner container clips overflow and applies responsive padding.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use the medium preset for multi-field forms and configuration dialogs.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperCenteredInterface preset="medium">
    <PaperCard padding="double" surface="front">
        <PaperText weight={600}>Configuration</PaperText>
    </PaperCard>
</PaperCenteredInterface>`}
            </PaperCode>
            <PaperCard padding="double" surface="back">
                <PaperCenteredInterface preset="medium">
                    <PaperCard padding="double" surface="front">
                        <PaperText weight={600}>Configuration</PaperText>
                    </PaperCard>
                </PaperCenteredInterface>
            </PaperCard>
        </PaperFlex>
    );
}
