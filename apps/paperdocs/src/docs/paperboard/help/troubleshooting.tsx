import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function TroubleshootingDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Troubleshooting</PaperText>
            <PaperText preset="body" as="p">
                The messages Paperboard and the server daemon show when something goes wrong, what causes each one, and what to do.
                Find the message you see, word for word, under its area.
                When a message is not here, the log has the full story: <PaperCode>logs/paperboard.log</PaperCode> in the <PaperLink href="/docs/paperboard/data-directory/">data directory</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="installing">Installing Paperboard</PaperText>

            <PaperText preset="title" as="h3" id="appimage-does-not-open">The Linux AppImage does not open</PaperText>
            <PaperText preset="body" as="p">
                The AppImage needs FUSE 2 and must be marked as a program.
                Install FUSE 2 from your distribution's packages, then run <PaperCode>chmod +x paperboard-linux-x64.AppImage</PaperCode> in its folder and open it again.
            </PaperText>

            <PaperText preset="title" as="h3" id="blocked-on-first-open">Windows or macOS blocks Paperboard</PaperText>
            <PaperText preset="body" as="p">
                The builds have no developer signature from Microsoft or Apple. On Windows, select <b>More info</b>, then <b>Run anyway</b>.
                On macOS, open <b>System Settings</b>, then <b>Privacy &amp; Security</b>, and select <b>Open Anyway</b>.
                The steps are in <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="server-daemon">Starting the server daemon</PaperText>

            <PaperText preset="title" as="h3" id="port-in-use">Port 45464 is already in use by another application</PaperText>
            <PaperText preset="body" as="p">
                Another program, or another server daemon, already listens on that port.
                Run <PaperCode>papercrane status</PaperCode> to see whether a daemon is running for this data directory. If one is, use it instead of starting another.
                Otherwise start this one on another port with <PaperCode>--port 45465</PaperCode>, and use that port in <b>Server port</b> when you add the computer.
            </PaperText>

            <PaperText preset="title" as="h3" id="cannot-start">Cannot start, with Check the data directory is writable</PaperText>
            <PaperText preset="body" as="p">
                The daemon cannot write to its data directory. The message names the directory.
                Make sure the folder belongs to the account running the daemon. A daemon started once with <PaperCode>sudo</PaperCode> can leave files that belong to root.
            </PaperText>

            <PaperText preset="title" as="h3" id="usage-error">A command line error, followed by its usage</PaperText>
            <PaperText preset="body" as="p">
                The command line has a mistake: an unknown option, a port that is not a number, or <PaperCode>--headless</PaperCode> with <PaperCode>--start-pairing</PaperCode>.
                Nothing started. The first line says what is wrong. Run <PaperCode>papercrane --help</PaperCode> for the options.
            </PaperText>

            <PaperText preset="title" as="h3" id="tls-identity">Paired computers trust this identity</PaperText>
            <PaperText preset="body" as="p">
                The daemon could not read its certificate, <PaperCode>local/tls_identity.json</PaperCode>. The start of the message says what is wrong with it.
                The daemon does not start, rather than make a new certificate behind your back.
                Restore the file from a copy if you have one. Otherwise move it aside: the daemon makes a new one, and every paired computer has to be forgotten and paired again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="service">Running as a service</PaperText>

            <PaperText preset="title" as="h3" id="already-running">A Paperboard server daemon is already running</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>install-service</PaperCode> found a daemon you started by hand for the same data directory. Stop it (press <PaperCode>s</PaperCode> on its screen), then install the service again.
            </PaperText>

            <PaperText preset="title" as="h3" id="needs-root">A --system service needs root, or This is running as root</PaperText>
            <PaperText preset="body" as="p">
                A system service is installed with <PaperCode>sudo papercrane install-service --system</PaperCode>. A user service is installed as your own account, without <PaperCode>sudo</PaperCode>.
            </PaperText>

            <PaperText preset="title" as="h3" id="did-not-start">The service was installed, but the daemon did not start within 20 seconds</PaperText>
            <PaperText preset="body" as="p">
                The service manager started the daemon, and it failed or did not answer. The message is followed by the service's last log lines, which say why.
                The service stays installed. Fix the cause and run <PaperCode>install-service</PaperCode> again, or remove it with <PaperCode>papercrane uninstall-service</PaperCode>.
            </PaperText>

            <PaperText preset="title" as="h3" id="stops-after-logout">The daemon stops when I close SSH</PaperText>
            <PaperText preset="body" as="p">
                A Linux user service stops with your last session. Turn on lingering with <PaperCode>sudo loginctl enable-linger &lt;your user name&gt;</PaperCode>, or install a system service.
                See <PaperLink href="/docs/paperboard/run-as-service/#user-or-system">A user service or a system service</PaperLink>.
            </PaperText>

            <PaperText preset="title" as="h3" id="not-running">The Paperboard server daemon is not running for</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>status</PaperCode> or <PaperCode>pair</PaperCode> found no daemon for that data directory.
                Start it, or point the command at the daemon's data directory with <PaperCode>--data-dir</PaperCode>. A service installed with <PaperCode>--data-dir</PaperCode> needs the same option here.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="connecting">Connecting a computer</PaperText>

            <PaperText preset="title" as="h3" id="cant-reach">Can't reach, then Check the address</PaperText>
            <PaperText preset="body" as="p">
                Paperboard could not reach the address you typed in <b>Computer Details</b>. The line below gives the reason:
            </PaperText>
            <PaperTextList>
                <li><PaperCode>Connection refused.</PaperCode> The computer answered, but no daemon listens on that port. Start the daemon, or check the port.</li>
                <li><PaperCode>Timed out with no response.</PaperCode> The computer is off, on another network, or a firewall blocks the port. Allow TCP port 45464 in the computer's firewall. On Windows, allow the daemon when Windows Firewall asks.</li>
                <li><PaperCode>Host not found.</PaperCode> The name does not resolve. Type the computer's IP address instead.</li>
                <li><PaperCode>Network unreachable.</PaperCode> This computer has no route to that address. Check that both are on the same network, or connected through your VPN.</li>
            </PaperTextList>

            <PaperText preset="title" as="h3" id="not-listed">The computer is not in the list</PaperText>
            <PaperText preset="body" as="p">
                Paperboard lists daemons it finds by multicast DNS on the local network. A daemon listening only on <PaperCode>127.0.0.1</PaperCode> is never announced, and many VPNs and guest networks do not carry the announcements.
                Select <b>Custom IP</b> and type the address that <PaperCode>papercrane pair</PaperCode> prints.
            </PaperText>

            <PaperText preset="title" as="h3" id="invalid-code">Invalid pairing code. Pairing is locked for 5 seconds</PaperText>
            <PaperText preset="body" as="p">
                The code was wrong. Wait the number of seconds shown, then type the code the daemon shows now.
                After the third wrong code, the wait is 30 seconds.
            </PaperText>

            <PaperText preset="title" as="h3" id="too-many-codes">Too many wrong pairing codes</PaperText>
            <PaperText preset="body" as="p">
                After 10 wrong codes from one address, or 100 in total, the daemon stops accepting codes. Start pairing again on the daemon for a new code.
            </PaperText>

            <PaperText preset="title" as="h3" id="pairing-not-active">Pairing is not currently active on this computer</PaperText>
            <PaperText preset="body" as="p">
                No code is open on the daemon. It was cancelled, or used by another computer. Press <PaperCode>p</PaperCode> on the daemon's screen, or run <PaperCode>papercrane pair</PaperCode>, and use the new code.
            </PaperText>

            <PaperText preset="title" as="h3" id="vault-full">Token vault is full (200 paired clients)</PaperText>
            <PaperText preset="body" as="p">
                The daemon already has 200 paired computers. Remove ones you no longer use on the daemon, then pair again.
            </PaperText>

            <PaperText preset="title" as="h3" id="nothing-to-pair">This daemon runs with --no-auth, so there is nothing to pair</PaperText>
            <PaperText preset="body" as="p">
                The daemon was started with <PaperCode>--no-auth</PaperCode>, which only serves this computer. Start it without that option to pair other computers.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="connected-computers">Paired computers</PaperText>

            <PaperText preset="title" as="h3" id="connection-lost">Connection Lost</PaperText>
            <PaperText preset="body" as="p">
                Paperboard lost the computer and keeps retrying by itself. Check that the computer is on and that its daemon runs (<PaperCode>papercrane status</PaperCode> on it), then select <b>Attempt Reconnect</b>.
                The line <PaperCode>Last error:</PaperCode> gives the reason, with the same meanings as in <PaperLink href="/docs/paperboard/troubleshooting/#cant-reach">Can't reach</PaperLink>.
            </PaperText>

            <PaperText preset="title" as="h3" id="certificate-changed">Certificate fingerprint does not match the paired computer</PaperText>
            <PaperText preset="body" as="p">
                The daemon at that address shows a different certificate from the one saved at pairing.
                Either its <PaperCode>local/tls_identity.json</PaperCode> was replaced, or another program answers at that address.
                If you replaced the identity or reinstalled the computer, forget the computer in Paperboard and pair it again. If you did not, find out what answers at that address before you pair.
            </PaperText>

            <PaperText preset="title" as="h3" id="pair-it-again">Remove this computer and pair it again</PaperText>
            <PaperText preset="body" as="p">
                The daemon no longer accepts this app's token: the computer was removed on the daemon, or its data directory was replaced. Select <b>Forget Computer</b>, then add it again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="panels">Panels</PaperText>

            <PaperText preset="title" as="h3" id="couldnt-install">Couldn't install</PaperText>
            <PaperText preset="body" as="p">
                The reason follows the panel's name.
                <PaperCode>Install refused</PaperCode> means the download failed the signature or checksum check, or the Panel Library could not be reached. Nothing was installed. Try again later, and if it repeats, <PaperLink href="/contact/">contact us</PaperLink> with the message.
                <PaperCode>An operation on</PaperCode> the panel <PaperCode>is already running</PaperCode> means it is being installed or removed already. Wait for that to finish.
            </PaperText>

            <PaperText preset="title" as="h3" id="library-unreachable">Couldn't reach the panel library</PaperText>
            <PaperText preset="body" as="p">
                This computer has no connection to the Panel Library. Check the internet connection, then select <b>Reload library</b>.
            </PaperText>

            <PaperText preset="title" as="h3" id="updates-waiting">1 update waiting</PaperText>
            <PaperText preset="body" as="p">
                A package update is ready, but a running panel is using the package. Select the button to see which panel. Stop that panel's processes, and the update installs.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="backups">Backups</PaperText>

            <PaperText preset="title" as="h3" id="choose-location-first">Choose where this panel's backups are kept first</PaperText>
            <PaperText preset="body" as="p">
                Routine backups need a location. Select <b>Choose</b> next to <b>Kept in</b>, pick a location, and turn routine backups on again.
            </PaperText>

            <PaperText preset="title" as="h3" id="newer-backup">This backup was made by version</PaperText>
            <PaperText preset="body" as="p">
                The backup comes from a newer version of the panel than the one installed. Update the panel with <b>Update everything now</b> in <b>Settings</b>, then restore.
            </PaperText>

            <PaperText preset="title" as="h3" id="backup-mismatch">The downloaded backup does not match its record; it was not restored</PaperText>
            <PaperText preset="body" as="p">
                The archive changed after it was made, or its download broke. Nothing was changed. Restore a different backup.
            </PaperText>

            <PaperText preset="title" as="h3" id="destinations-damaged">The backup locations file destinations.json could not be read</PaperText>
            <PaperText preset="body" as="p">
                The computer's list of backup locations is damaged. On its Computer Info page, under <b>Backups</b>, select <b>Set Aside and Start Fresh</b>.
                The damaged file is kept beside the new one, and backups already at your locations are not deleted. Panels ask for a location again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="updates">Updates</PaperText>

            <PaperText preset="title" as="h3" id="server-update-no-report">Paperboard Server update did not report back</PaperText>
            <PaperText preset="body" as="p">
                The new server daemon was put in place on that computer, but it only runs after the daemon restarts.
                Restart the daemon there, for example with <PaperCode>systemctl --user restart papercrane</PaperCode> for a Linux user service.
                The next update check finds the new version running.
            </PaperText>

            <PaperText preset="title" as="h3" id="windows-self-update">Self-update is not supported on Windows yet</PaperText>
            <PaperText preset="body" as="p">
                A server daemon on Windows does not update itself. Download the new zip from <PaperLink href="/docs/paperboard/server-daemon/#download">Install the server daemon</PaperLink>, stop the daemon, and replace its files.
            </PaperText>

            <PaperText preset="title" as="h3" id="package-manager">Update Paperboard with the package manager you used to install it</PaperText>
            <PaperText preset="body" as="p">
                This Paperboard was not installed from the AppImage, so it cannot update itself. Update it the way you installed it, or switch to the AppImage from <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
