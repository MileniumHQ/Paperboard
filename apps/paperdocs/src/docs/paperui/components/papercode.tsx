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
            <PaperText preset="header">PaperCode</PaperText>
            <PaperSeparator />
            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>PaperCode</PaperCode> component can be used to
                display program terms or code with proper formatting, fonts,
                separation and highlighting.
            </PaperText>
            <PaperText preset="title">Block Example</PaperText>
            <PaperCode block lang="js">{`<PaperCode block lang="js">
{\`function decideIfFriend() {
    const answer = prompt("Do you like Sonic?");
    if (answer == "yes") {
        alert("You're my friend!");
        return true;
    } else {
        alert("You're not my friend. :(");
        return false;
        }
    }
\`}
</PaperCode>`}</PaperCode>
            <PaperContainer>
                <PaperFlex center padding="full">
                    <PaperCode block lang="js">
                        {`function decideIfFriend() {
    const answer = prompt("Do you like Sonic?");
    if (answer == "yes") {
        alert("You're my friend!");
        return true;
    } else {
        alert("You're not my friend. :(");
        return false;
    }
}`}
                    </PaperCode>
                </PaperFlex>
            </PaperContainer>
            <PaperText preset="title">Inline Example</PaperText>
            <PaperCode
                block
                lang="js"
            >{`<PaperCode>SonicFriendshipStatus</PaperCode>`}</PaperCode>
            <PaperContainer>
                <PaperFlex center padding="full">
                    <PaperCode>SonicFriendshipStatus</PaperCode>
                </PaperFlex>
            </PaperContainer>
            <PaperText id="syntax-highlighting" preset="subheader">
                Syntax Highlighting
            </PaperText>
            <PaperText preset="body">
                When using <PaperCode>block</PaperCode>, PaperCode automatically
                applies syntax highlighting using{" "}
                <PaperLink external href="https://prismjs.com">
                    Prism.js
                </PaperLink>
                .<br />
                <strong>Supported languages:</strong>
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperCode>tsx</PaperCode>
                    <PaperCode>typescript</PaperCode>
                    <PaperCode>ts</PaperCode>
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>jsx</PaperCode>
                    <PaperCode>javascript</PaperCode>
                    <PaperCode>js</PaperCode>
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>css</PaperCode>
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>json</PaperCode>
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>bash</PaperCode>
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>clike</PaperCode> (
                    <PaperText>C-like languages</PaperText>)
                </PaperText>
            </PaperTextList>
            <PaperText id="copy-to-clipboard" preset="subheader">
                Copy-to-Clipboard
            </PaperText>
            <PaperText preset="body">
                PaperCode includes a copy-to-clipboard button enabled by default
                in the top right. To disable it, set the{" "}
                <PaperCode>copyable</PaperCode> prop to{" "}
                <PaperCode>false</PaperCode>.
            </PaperText>
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
                            <PaperCode>block</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>Renders contents as a multi-line code block.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>language</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"tsx"</PaperCode>
                        </td>
                        <td>
                            Language for syntax highlighting to appear in (if{" "}
                            <PaperCode>block</PaperCode> is enabled).
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>copyable</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>block ? true : false</PaperCode>
                        </td>
                        <td>Enables the copy-to-clipboard button.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>children</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Code snippet.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </>
    );
}
