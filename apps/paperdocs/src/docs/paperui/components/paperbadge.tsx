import {
    PaperBadge,
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
            <PaperText preset="header">PaperBadge</PaperText>
            <PaperSeparator />
            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>PaperBadge</PaperCode> component can be used to
                display a status or label inline. It supports icons and various
                color variants.
            </PaperText>
            <PaperCode
                block
                lang="tsx"
            >{`<PaperBadge variant="green" icon="check">Active</PaperBadge>`}</PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperBadge variant="green" icon="check">
                        Active
                    </PaperBadge>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="variants" preset="subheader">
                Variants
            </PaperText>
            <PaperText preset="body">
                Using the <PaperCode>variant</PaperCode> prop, the component's
                five different color variants can be used to signify different
                states. Here are some example use cases for each color:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperCode>blue</PaperCode> Neutral, informative, or
                    pending.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>red</PaperCode> Failed or denied.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>green</PaperCode> Succeeded or accepted.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>yellow</PaperCode> Warning or in progress.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>monochrome</PaperCode> Disabled or neutral.
                </PaperText>
            </PaperTextList>
            <PaperCode block language="jsx">
                {`<PaperBadge variant="blue">In Review</PaperBadge>
<PaperBadge variant="red">Failed</PaperBadge>
<PaperBadge variant="green">Completed</PaperBadge>
<PaperBadge variant="yellow">Warning</PaperBadge>
<PaperBadge variant="monochrome">1.0.2</PaperBadge>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperBadge variant="blue">In Review</PaperBadge>
                    <PaperBadge variant="red">Failed</PaperBadge>
                    <PaperBadge variant="green">Completed</PaperBadge>
                    <PaperBadge variant="yellow">Warning</PaperBadge>
                    <PaperBadge variant="monochrome">1.0.2</PaperBadge>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="icons" preset="subheader">
                Icons
            </PaperText>
            <PaperText preset="body">
                PaperBadge supports a standard{" "}
                <PaperLink href="./papericon">
                    <PaperCode>PaperIcon</PaperCode>
                </PaperLink>{" "}
                component or icon name string via the{" "}
                <PaperCode>icon</PaperCode> prop.
            </PaperText>

            <PaperCode block language="jsx">
                {`<PaperBadge variant="red" icon="exclamation">Important</PaperBadge>
<PaperBadge variant="blue" icon="flash_on">Sonic</PaperBadge>
<PaperBadge variant="green" icon="rocket_launch">Built in 0.2s</PaperBadge>`}
            </PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="half">
                    <PaperBadge variant="red" icon="exclamation">
                        Important
                    </PaperBadge>
                    <PaperBadge variant="blue" icon="flash_on">
                        Sonic
                    </PaperBadge>
                    <PaperBadge variant="green" icon="rocket_launch">
                        Built in 0.2s
                    </PaperBadge>
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
                                "monochrome" | "blue" | "green" | "yellow" |
                                "red"
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>"monochrome"</PaperCode>
                        </td>
                        <td>Color theme or variant of the badge.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>icon</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Icon name string or PaperIcon component.</td>
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
                        <td>Badge label.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </>
    );
}
