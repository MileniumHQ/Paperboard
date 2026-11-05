import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PanelLibraryGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Get into the Panel Library</PaperText>
            <PaperText preset="body" as="p">
                A panel gets into the Panel Library by working with the Paperboard team, who review it and publish it.
                There is no public store to upload to. Write to the team, and they take the panel the rest of the way with you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="why">Why every panel is reviewed</PaperText>
            <PaperText preset="body" as="p">
                Paperboard trusts panels completely. A panel's service runs with the full reach of the account running Paperboard: it reads and writes files, starts programs and talks to the network, with no sandbox around it.
                A person who installs a panel from the Panel Library trusts it the same way, so the team reads every panel and every version before it ships.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-write">Before you write</PaperText>
            <PaperTextList>
                <li>The panel passes the <PaperLink href="/docs/developers/checklist/">panel checklist</PaperLink>: its build, tests and <PaperCode>bunx paperapi doctor</PaperCode> pass.</li>
                <li><PaperCode>bunx paperapi pack</PaperCode> makes its archive. See <PaperLink href="/docs/developers/packaging/">Package a panel</PaperLink>.</li>
                <li>Its manifest has a <PaperCode>store</PaperCode> block for its page in the Panel Library: the about text, screenshots in the light and the dark theme, and the services it uses. See <PaperLink href="/docs/paperapi/store-listing/">Store listing</PaperLink>.</li>
                <li>Its source is somewhere the team can read it, such as a Git repository.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="send-it">Send it to the team</PaperText>
            <PaperText preset="body" as="p">
                Use the <PaperLink href="/contact/">contact form</PaperLink> and choose <b>Panel submission</b>, or email <PaperLink href="mailto:contact@mileniumhq.com">contact@mileniumhq.com</PaperLink> with the subject <PaperCode>[Paperboard] Panel submission</PaperCode>. Write:
            </PaperText>
            <PaperTextList>
                <li>The panel's name and id, and what a person gets from it.</li>
                <li>A link to its source.</li>
                <li>What it needs to run: accounts, API keys, programs it downloads, and the operating systems it works on.</li>
                <li>How to try it, including how to get any key it needs.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Never send a key, token or password. When the team needs an account to try the panel, they set up their own.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="after">What happens next</PaperText>
            <PaperTextList>
                <li>The team reads the source, runs the panel, and writes back with what has to change. Expect a conversation, not a form with a yes or no.</li>
                <li>When the panel is ready, the team publishes it, and it appears in the Panel Library on every Paperboard.</li>
                <li>Every later version goes through the team in the same way. Raise <PaperCode>version</PaperCode> in the manifest and send the change.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="your-own-computers">Run it on your own computers</PaperText>
            <PaperText preset="body" as="p">
                A panel needs no review to run on computers you own.
            </PaperText>
            <PaperTextList>
                <li>On the computer you develop on, <PaperCode>bunx paperapi link</PaperCode> runs it from its folder. See <PaperLink href="/docs/developers/dev-loop/">The development loop</PaperLink>.</li>
                <li>On your other computers, unpack its archive into Paperboard's data folder. See <PaperLink href="/docs/developers/packaging/#install-by-hand">Install it on your computers</PaperLink>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A panel run this way gets no updates from the Panel Library. Install it again for each new version.
            </PaperText>
        </PaperFlex>
    );
}
