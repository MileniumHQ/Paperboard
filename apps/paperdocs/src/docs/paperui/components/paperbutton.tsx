import {
    PaperBadge,
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperEffect,
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
            <PaperText preset="header">PaperButton</PaperText>
            <PaperSeparator />
            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>PaperButton</PaperCode> component is the primary
                button component in PaperUI. It supports icons, as well as
                various size and color variants.
            </PaperText>
            <PaperCode
                block
                lang="tsx"
            >{`<PaperButton>Open</PaperButton>`}</PaperCode>
            <PaperContainer>
                <PaperFlex center padding="full">
                    <PaperButton>Open</PaperButton>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="variants" preset="subheader">
                Variants
            </PaperText>
            <PaperText preset="body">
                Using the <PaperCode>variant</PaperCode> prop, the component's
                five different color variants can be used to signify the type of
                action the button is related to. Here are some example use cases
                for each color:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperCode>blue</PaperCode> (or <PaperCode>brand</PaperCode>
                    ) This is the brand color, therefore should be the default
                    choice for buttons.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>red</PaperCode> Breaking or dangerous action.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>green</PaperCode> Action resulting in completion
                    or success.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>yellow</PaperCode> Risky action.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>text</PaperCode> Less important action.
                </PaperText>
            </PaperTextList>
            <PaperCode block language="jsx">
                {`<PaperButton variant="blue">Open</PaperButton>
<PaperButton variant="red">Delete</PaperButton>
<PaperButton variant="green">Finish</PaperButton>
<PaperButton variant="yellow">Rename</PaperButton>
<PaperButton variant="text">Back</PaperButton>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperButton variant="blue">Open</PaperButton>
                    <PaperButton variant="red">Delete</PaperButton>
                    <PaperButton variant="green">Finish</PaperButton>
                    <PaperButton variant="yellow">Rename</PaperButton>
                    <PaperButton variant="text">Back</PaperButton>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="icons" preset="subheader">
                Icons
            </PaperText>
            <PaperText preset="body">
                PaperButton supports a standard{" "}
                <PaperLink href="./papericon">
                    <PaperCode>PaperIcon</PaperCode>
                </PaperLink>{" "}
                component inline.
            </PaperText>
            <PaperCode block language="jsx">
                {`<PaperButton variant="green"><PaperIcon>check_circle</PaperIcon> Finish</PaperButton>
<PaperButton variant="red">
    <PaperIcon>close</PaperIcon>
    Close
</PaperButton>
<PaperButton variant="text">
    <PaperIcon>arrow_back</PaperIcon>
    Back
</PaperButton>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperButton variant="green">
                        <PaperIcon>check_circle</PaperIcon> Finish
                    </PaperButton>
                    <PaperButton variant="red">
                        <PaperIcon>close</PaperIcon> Close
                    </PaperButton>
                    <PaperButton variant="text">
                        <PaperIcon>arrow_back</PaperIcon> Back
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>
            <PaperText preset="body">
                Or, you can set the <PaperCode>icon</PaperCode> prop if you
                intend for the button to only include an icon.
            </PaperText>
            <PaperCode block language="jsx">
                {`<PaperButton icon>
    <PaperIcon>info</PaperIcon>
</PaperButton>
<PaperButton icon variant="yellow">
    <PaperIcon>warning</PaperIcon>
</PaperButton>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperButton icon>
                        <PaperIcon>info</PaperIcon>
                    </PaperButton>
                    <PaperButton icon variant="yellow">
                        <PaperIcon>warning</PaperIcon>
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="sizes" preset="subheader">
                Sizes
            </PaperText>
            <PaperText preset="body">
                PaperButton also supports various sizes so it can maintain its
                use across different types of interfaces. Pick whichever button
                fits your use case best!
            </PaperText>
            <PaperText preset="body">
                You can add each size by simply adding their corresponding prop.
                (<PaperCode>compact</PaperCode>, <PaperCode>tiny</PaperCode>)
            </PaperText>
            <PaperCode block language="jsx">
                {`<PaperButton>Normal</PaperButton>
<PaperButton compact>Compact</PaperButton>
<PaperButton tiny>Tiny</PaperButton>
<PaperButton icon>
    <PaperIcon>clock_loader_90</PaperIcon>
</PaperButton>
<PaperButton compact icon>
    <PaperIcon>clock_loader_60</PaperIcon>
</PaperButton>
<PaperButton tiny icon>
    <PaperIcon>clock_loader_10</PaperIcon>
</PaperButton>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperButton>Normal</PaperButton>
                    <PaperButton compact>Compact</PaperButton>
                    <PaperButton tiny>Tiny</PaperButton>
                    <PaperButton icon>
                        <PaperIcon>clock_loader_90</PaperIcon>
                    </PaperButton>
                    <PaperButton compact icon>
                        <PaperIcon>clock_loader_60</PaperIcon>
                    </PaperButton>
                    <PaperButton tiny icon>
                        <PaperIcon>clock_loader_10</PaperIcon>
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="papereffect" preset="subheader">
                PaperEffect
            </PaperText>
            <PaperText preset="body">
                PaperButton is designed from the beginning to work great in
                tandem with <PaperLink href="./papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink>, and vice versa.
            </PaperText>
            <PaperText preset="body">
                You can learn more about <PaperLink href="./papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink> and how it's meant to be
                used.
            </PaperText>
            <PaperCode block language="jsx">
                {`<PaperEffect>
    <PaperButton>Quirky Button</PaperButton>
</PaperEffect>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperEffect>
                        <PaperButton>Quirky Button</PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperContainer>
            <PaperSeparator />
            <PaperText id="props" preset="subheader">
                Props
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
                            <PaperCode>variant</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                "blue" | "green" | "yellow" | "red" | "brand" |
                                "text"
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>brand</PaperCode>
                        </td>
                        <td>Color variant of the button.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>icon</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>Applies icon-only button styling.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>compact</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>Applies compact size styling.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>tiny</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>Applies tiny size styling.</td>
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
                        <td>Disables the button and prevents interaction.</td>
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
                        <td>Button content.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </>
    );
}
