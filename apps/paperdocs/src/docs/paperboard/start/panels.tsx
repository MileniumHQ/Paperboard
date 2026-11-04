import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PanelsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Install and manage panels</PaperText>
            <PaperText preset="body" as="p">
                Install panels from the Panel Library onto any of your computers, and put their widgets on Home.
                A panel runs on the computer you install it on, so pick that computer first.
                Paperboard keeps installed panels up to date for you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="install-a-panel">Install a panel</PaperText>
            <PaperTextList ordered>
                <li>In the rail on the left, select the computer the panel should run on.</li>
                <li>In its sidebar, select <b>Panel Library</b>.</li>
                <li>Select a panel to open its page. The page lists its publisher, size and version.</li>
                <li>Select <b>Install</b>. When the install finishes, Paperboard opens the panel.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The panel appears in the computer's sidebar. A panel that is already installed shows <b>Open</b> instead of <b>Install</b>, and an <b>Installed</b> mark on its card.
            </PaperText>
            <PaperText preset="body" as="p">
                The computer downloads the panel itself and checks it before installing: the file must match its checksum and carry the Paperboard release signature.
                A panel that fails either check is not installed.
                If an install fails partway, the computer puts the previous version back.
            </PaperText>
            <PaperText preset="body" as="p">
                A failed install shows <PaperCode>Couldn't install</PaperCode> with the panel's name and the reason under the button.
                If the Panel Library itself does not load, Paperboard shows <PaperCode>Couldn't reach the panel library.</PaperCode> with a <b>Reload library</b> button.
                You can also right-click <b>Panel Library</b> and choose <b>Reload Library</b>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="updates">Keep panels up to date</PaperText>
            <PaperText preset="body" as="p">
                Paperboard updates installed panels on every computer when it opens, and when you select <b>Update everything now</b> in <b>Settings</b>.
                There is no update button for a single panel.
                A panel page in the Panel Library shows <b>Latest</b> next to your installed version when a newer one is out.
            </PaperText>
            <PaperText preset="body" as="p">
                Some panels use packages, such as a Java runtime for a Minecraft server.
                When a package needs an update while a panel is using it, the top bar shows <b>1 update waiting</b>.
                Select it to see which panel holds the package. Stop that panel's processes and the update installs.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="restart-a-panel">Restart a panel</PaperText>
            <PaperText preset="body" as="p">
                Right-click the panel in the sidebar and choose <b>Restart Panel</b>.
                The same menu has <b>Show Tutorial</b> when the panel has a tutorial.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="uninstall-a-panel">Uninstall a panel</PaperText>
            <PaperTextList ordered>
                <li>Right-click the panel in the sidebar and choose <b>Uninstall Panel</b>.</li>
                <li>Leave <b>Also delete this panel's data and saved credentials</b> off to keep its data, or turn it on to delete it.</li>
                <li>Select <b>Uninstall</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                By default, uninstalling stops the panel and removes its program. Its settings, files and saved credentials stay on the computer, and installing the panel again picks them up.
                With the checkbox on, Paperboard also deletes the panel's settings, files, saved credentials and routine backups. This cannot be undone.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="home-widgets">Put widgets on Home</PaperText>
            <PaperText preset="body" as="p">
                Home shows widgets from all of your computers on one page.
                Paperboard has its own widgets (Clock, CPU, Memory, Disk, Network, Uptime, Panels, Computers and Flag), and panels add more.
            </PaperText>
            <PaperTextList ordered>
                <li>Select <b>Home</b> in the rail.</li>
                <li>Select <b>Add widgets</b>. Once Home has widgets, select <b>Edit Home</b> instead.</li>
                <li>Choose where the widget comes from: <b>Paperboard</b>, or one of your panels.</li>
                <li>Drag a widget onto Home, or click it to add it.</li>
                <li>Select <b>Done</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                To remove a widget, choose <b>Remove from Home</b> on it.
                A widget can be moved with the arrow keys and removed with Delete.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="microphone-camera-screen">Microphone, camera and screen</PaperText>
            <PaperText preset="body" as="p">
                The first time a panel asks for your microphone, camera or screen, Paperboard asks you and remembers the answer for that panel.
                Change it later in <b>Settings</b>, under <b>Panel permissions</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                Panels are not sandboxed. A panel can do anything the account running Paperboard can do on its computer.
                See <PaperLink href="/docs/paperboard/security/">Security and trust</PaperLink>.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/server-daemon/">run panels on another computer</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
