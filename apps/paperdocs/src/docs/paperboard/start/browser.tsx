import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BrowserDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Use Paperboard in a browser</PaperText>
            <PaperText preset="body" as="p">
                Paperboard can open in your web browser instead of its own window.
                It is the same app, with the same computers and panels, served by Paperboard on your computer.
                Nothing goes through the internet.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="open">Open it</PaperText>
            <PaperTextList>
                <li>Right-click Paperboard's icon in the taskbar or menu bar and choose <PaperCode>Open in Browser</PaperCode>. On Windows it's also on Paperboard's taskbar button.</li>
                <li>Or start Paperboard with <PaperCode>paperboard --web</PaperCode>. It opens in your browser without a window. If Paperboard is already running, the running app opens it.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Your default browser opens <PaperCode>http://localhost:45470</PaperCode>, signed in.
                Paperboard keeps that address, so a bookmark finds it again.
                To use another port, start Paperboard with <PaperCode>--web-port=&lt;port&gt;</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="sign-in">Signing in</PaperText>
            <PaperText preset="body" as="p">
                There is no password. Paperboard opens the browser with a sign-in link that works once, for five minutes.
                The browser then stays signed in for 30 days, including after Paperboard or your computer restarts.
                A browser that isn't signed in sees a page that says how to open Paperboard from Paperboard.
            </PaperText>
            <PaperText preset="body" as="p">
                To sign a browser out, open App Settings and choose <PaperCode>Sign Out</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="differences">What's different</PaperText>
            <PaperTextList>
                <li>Paperboard has to be running. Closing the browser tab leaves it running in the taskbar or menu bar.</li>
                <li>Paperboard updates itself only when it runs as a window.</li>
                <li>The browser keeps its own permissions for the microphone, camera and screen, so it asks for them itself.</li>
                <li>Backup locations that sign in through the desktop app, like Google Drive, are added from the window.</li>
                <li>Only this computer can open it. Paperboard listens on <PaperCode>127.0.0.1</PaperCode>, never on your network. To use another computer's panels, <PaperLink href="/docs/paperboard/connect/">connect that computer</PaperLink> to Paperboard.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                See <PaperLink href="/docs/paperboard/security/#browser">Security and trust</PaperLink> for what protects it.
            </PaperText>
        </PaperFlex>
    );
}
