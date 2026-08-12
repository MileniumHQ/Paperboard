import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperContainer</PaperText>
            <PaperSeparator />
            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>PaperContainer</PaperCode> component is a wrapper
                for placing other components in a UI while still giving them
                visual separation.
            </PaperText>
            <PaperText preset="body">
                This component is best used with{" "}
                <PaperLink href="./paperflex">
                    <PaperCode>PaperFlex</PaperCode>
                </PaperLink>{" "}
                or to contain fullscreen components like{" "}
                <PaperLink href="./papersettings">
                    <PaperCode>PaperSettingList</PaperCode>
                </PaperLink>
                . This entire documentation uses PaperContainer elements to
                display live examples of code.
            </PaperText>
            <PaperCode block lang="tsx">{`<PaperContainer>
    <PaperFlex center padding="full">
        <PaperButton>I'm inside a container</PaperButton>
    </PaperFlex>
</PaperContainer>`}</PaperCode>
            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperContainer>
                        <PaperFlex center padding="full">
                            <PaperButton>I'm inside a container</PaperButton>
                        </PaperFlex>
                    </PaperContainer>
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
                            <PaperCode>children</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Child elements.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </>
    );
}
