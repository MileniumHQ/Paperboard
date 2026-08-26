import {
    PaperButton,
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
            <PaperText preset="header">PaperButton</PaperText>
            <PaperText preset="body">
                <strong>PaperButton</strong> is the primary interactive button component in PaperUI, providing tactile feedback, semantic color variants, dimensional sizing modifiers, and icon-only layouts.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperButton is an accessible clickable primitive extending native HTML <PaperCode>&lt;button&gt;</PaperCode> capabilities. It incorporates tactile elevation borders, active compression dynamics, focus management, and automatic accessibility labelling for icon buttons.
            </PaperText>

            <PaperSeparator />

            <PaperText id="variants" preset="subheader">
                Color and style variants
            </PaperText>
            <PaperText preset="body">
                Buttons support five chromatic styles alongside a borderless <PaperCode>"text"</PaperCode> variant. Note that the base stylesheet sets <PaperCode>--foreground</PaperCode> to <PaperCode>--paper-front-blue</PaperCode>, so a button without an explicit <PaperCode>variant</PaperCode> prop renders blue — visually identical to <PaperCode>variant="blue"</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="half" wrap>
    <PaperButton>Default</PaperButton>
    <PaperButton variant="brand">Brand</PaperButton>
    <PaperButton variant="blue">Blue</PaperButton>
    <PaperButton variant="green">Green</PaperButton>
    <PaperButton variant="yellow">Yellow</PaperButton>
    <PaperButton variant="red">Red</PaperButton>
    <PaperButton variant="text">Text Button</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half" wrap>
                    <PaperButton>Default</PaperButton>
                    <PaperButton variant="brand">Brand</PaperButton>
                    <PaperButton variant="blue">Blue</PaperButton>
                    <PaperButton variant="green">Green</PaperButton>
                    <PaperButton variant="yellow">Yellow</PaperButton>
                    <PaperButton variant="red">Red</PaperButton>
                    <PaperButton variant="text">Text Button</PaperButton>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="sizing" preset="subheader">
                Sizing modifiers
            </PaperText>
            <PaperText preset="body">
                Density can be reduced using the <PaperCode>compact</PaperCode> and <PaperCode>tiny</PaperCode> boolean props for toolbars, inline actions, and data tables:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="half" align="center">
    <PaperButton variant="blue">Standard</PaperButton>
    <PaperButton variant="blue" compact>Compact</PaperButton>
    <PaperButton variant="blue" tiny>Tiny</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half" align="center" wrap>
                    <PaperButton variant="blue">Standard</PaperButton>
                    <PaperButton variant="blue" compact>Compact</PaperButton>
                    <PaperButton variant="blue" tiny>Tiny</PaperButton>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="icon-buttons" preset="subheader">
                Icon buttons
            </PaperText>
            <PaperText preset="body">
                Passing the <PaperCode>icon</PaperCode> boolean prop formats the button into an equal-ratio square container optimized for single icon glyphs. The button automatically copies plain text children into the <PaperCode>aria-label</PaperCode> attribute if a dedicated label is omitted.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="half">
    <PaperButton icon variant="blue" aria-label="Search">
        <PaperIcon zeroHeight>search</PaperIcon>
    </PaperButton>
    <PaperButton icon variant="green" aria-label="Add item">
        <PaperIcon zeroHeight>add</PaperIcon>
    </PaperButton>
    <PaperButton icon variant="red" tiny aria-label="Delete">
        <PaperIcon zeroHeight>delete</PaperIcon>
    </PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperButton icon variant="blue" aria-label="Search">
                        <PaperIcon zeroHeight>search</PaperIcon>
                    </PaperButton>
                    <PaperButton icon variant="green" aria-label="Add item">
                        <PaperIcon zeroHeight>add</PaperIcon>
                    </PaperButton>
                    <PaperButton icon variant="red" tiny aria-label="Delete">
                        <PaperIcon zeroHeight>delete</PaperIcon>
                    </PaperButton>
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
                        <td><PaperCode>"blue" | "green" | "yellow" | "red" | "brand" | "text"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Color style variant modifying button background and border palette.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Reduces padding and font size for medium-density layouts.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tiny</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Minimizes dimensions for dense toolbars and table rows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Enforces square dimensions for icon-only button layouts.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Disables user interaction and applies muted opacity.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"button" | "submit" | "reset"</PaperCode></td>
                        <td><PaperCode>"button"</PaperCode></td>
                        <td>HTML button execution type attribute.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td><PaperCode>HTMLButtonElement | ((el: HTMLButtonElement) =&gt; void)</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Receives the underlying native <PaperCode>&lt;button&gt;</PaperCode> element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papereffect">PaperEffect</PaperLink> — Tactile container creating raised 3D borders for buttons.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papericon">PaperIcon</PaperLink> — Icon component designed for embedding inside PaperButton.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlink">PaperLink</PaperLink> — Anchor component for URL-based navigation.
                </PaperText>
            </PaperTextList>
        </>
    );
}
