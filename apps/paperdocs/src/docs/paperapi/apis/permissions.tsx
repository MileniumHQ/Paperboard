import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PermissionsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Permissions</PaperText>
            <PaperText preset="body">
                Panels use the microphone, camera and screen through the standard web APIs, with no Paperboard import.
                The first time a panel asks, Paperboard asks the user whether that panel may use it, and keeps the answer.
                The user can change any answer later in App Settings, under Panel permissions.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Call getUserMedia or getDisplayMedia from the panel's page as you would in a browser.
                The call waits while the user answers, then resolves with the stream or rejects with NotAllowedError.
                The clipboard isn't a permission: every panel can read and write it without asking.
            </PaperText>
            <PaperCode block language="tsx">
{`const stream = await navigator.mediaDevices.getUserMedia({ audio: true });`}
            </PaperCode>

            <PaperText preset="subheader" id="permissions">Permissions</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Web API</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Microphone</td>
                        <td><PaperCode>getUserMedia({"{ audio }"})</PaperCode></td>
                        <td>Audio input, such as calls and dictation.</td>
                    </tr>
                    <tr>
                        <td>Camera</td>
                        <td><PaperCode>getUserMedia({"{ video }"})</PaperCode></td>
                        <td>Video input. Asking for audio and video together is one question.</td>
                    </tr>
                    <tr>
                        <td>Screen sharing</td>
                        <td><PaperCode>getDisplayMedia({"{ video }"})</PaperCode></td>
                        <td>A screen or window the user picks each time. System audio isn't shared.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Answers are kept per panel, on the computer Paperboard runs on, so every computer's copy of a panel shares one answer.
                A refused panel isn't asked again: its requests reject straight away until the user allows it in App Settings.
                Closing the question without answering refuses that one request and asks again next time.
            </PaperText>
            <PaperText preset="body">
                Screen sharing asks once, then lets the user pick what to share on every call.
                Where the desktop has its own share dialog (Linux on Wayland), that dialog does the picking; elsewhere Paperboard shows its own.
            </PaperText>
            <PaperText preset="body">
                macOS and Windows also decide whether Paperboard itself may use a device.
                When the system blocks it, Paperboard tells the user and opens the right system settings, and the request rejects with NotAllowedError.
                Permissions apply to a panel's page, not its widgets. In browser mode the browser asks instead.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Show a refusal, with where to change it, instead of a dead button.
            </PaperText>
            <PaperCode block language="tsx">
{`try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startRecording(stream);
} catch (err) {
    if ((err as Error).name === "NotAllowedError") {
        setError("Recording needs the microphone. Allow it in App Settings, under Panel permissions.");
    } else {
        setError(\`The microphone isn't available: \${(err as Error).message}\`);
    }
}`}
            </PaperCode>
            <PaperText preset="body">
                Stop a stream's tracks when you're done with it, so the device turns off.
            </PaperText>
            <PaperCode block language="tsx">
{`for (const track of stream.getTracks()) track.stop();`}
            </PaperCode>
        </PaperFlex>
    );
}
