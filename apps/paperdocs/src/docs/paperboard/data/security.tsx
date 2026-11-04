import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function SecurityDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Security and trust</PaperText>
            <PaperText preset="body" as="p">
                Paperboard encrypts connections between computers and locks each one to the computer you paired.
                It trusts panels completely, and it keeps secrets in files only your account can read, not in encrypted ones.
                Each claim below is what the code does, with what it protects against.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="network">Connections between computers</PaperText>
            <PaperTextList>
                <li>The server daemon listens on every network on port <PaperCode>45464</PaperCode> unless you choose otherwise.</li>
                <li>A daemon that other computers can reach accepts only encrypted (TLS) connections from them. It makes its own certificate the first time it starts, keeps it in <PaperCode>local/tls_identity.json</PaperCode>, and uses it for ten years.</li>
                <li>Unencrypted connections exist only inside the computer, on <PaperCode>127.0.0.1</PaperCode>, for Paperboard and panels running on that same computer.</li>
                <li>The daemon built into the desktop app listens on <PaperCode>127.0.0.1</PaperCode> only. No other computer can connect to it.</li>
                <li>Every request needs a token, except a health check that answers with <PaperCode>ok</PaperCode> and the daemon's version, and the pairing request itself.</li>
                <li>The daemon refuses requests addressed to a name it does not have. This stops a web page in your browser from reaching the daemon under a borrowed address.</li>
                <li>On a local network, the daemon announces itself with its computer name, version, operating system and a random id, so Paperboard can list it. It announces no codes, tokens or certificates.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="pairing">Pairing</PaperText>
            <PaperTextList>
                <li>The daemon shows a pairing code only when you ask for one. A daemon on the network never offers a code by itself.</li>
                <li>The code is 6 random digits. Wrong codes lock the sender out for 5 seconds, then 30 seconds, end pairing for that address after 10, and end pairing for everyone after 100.</li>
                <li>While pairing, Paperboard has not yet seen the daemon's certificate, so it accepts the one it is shown and saves it. Someone who controls the network at that moment could pose as the daemon. That is why both the daemon and this page say to pair only on a network you trust.</li>
                <li>After pairing, Paperboard connects only to a daemon showing the saved certificate, wherever the computer is. A daemon with a new certificate is refused, and you pair it again.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="tokens">Tokens</PaperText>
            <PaperTextList>
                <li>Each paired computer gets its own random token. The daemon keeps them in <PaperCode>local/authorized_tokens.json</PaperCode>, and the desktop app keeps its copies in <PaperCode>local/paired_computers.json</PaperCode>. Both are plain files inside the private <PaperCode>local/</PaperCode> folder.</li>
                <li>Tokens do not expire. A token works until you forget the computer in Paperboard or remove it on the daemon. See <PaperLink href="/docs/paperboard/connect/#remove-from-the-daemon">Remove a paired computer from the daemon</PaperLink>.</li>
                <li>Programs on the same computer reach the daemon through <PaperCode>local/crane.json</PaperCode>, which holds a token and only your account can read. The daemon proves it holds that token before a program sends it, so a different program on the same port learns nothing.</li>
                <li>Each panel gets a token of its own, which reaches only that panel's own settings, files and secrets through Paperboard.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="panels">Panels run with full trust</PaperText>
            <PaperText preset="body" as="p">
                Paperboard does not sandbox panels.
                A panel's background program runs as an ordinary program with the rights of the account that runs the daemon. It can read and change any file that account can, start any program, and reach the network.
                The panel token above keeps panels from reaching each other's data through Paperboard. It does not stop a panel that opens files directly.
            </PaperText>
            <PaperText preset="body" as="p">
                A panel's page runs in its own frame in the Paperboard window.
                It needs your permission for the microphone, camera and screen. The clipboard is open to every panel.
            </PaperText>
            <PaperText preset="body" as="p">
                This is why every panel in the Panel Library is reviewed by the Paperboard team before it is published.
                Installing a panel means trusting it as much as any program you install. See <PaperLink href="/docs/guides/panel-library/">Get into the Panel Library</PaperLink> for what the review checks.
            </PaperText>
            <PaperText preset="body" as="p">
                The daemon runs as your account, never as root unless you install a system service with <PaperCode>--run-as root</PaperCode>. That would give every panel root.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="secrets">Secrets</PaperText>
            <PaperText preset="body" as="p">
                Passwords, keys and tokens that panels save, and the sign-ins of backup locations, are kept in <PaperCode>local/secrets.json</PaperCode>.
                It is plain JSON, not encrypted. On Linux and macOS only your account can read it, and Paperboard never hands it out through its file access.
            </PaperText>
            <PaperText preset="body" as="p">
                This protects secrets from other accounts on the computer, and keeps them out of panel settings and panel backups.
                It does not protect them from programs running as your account, which includes every panel, or from anyone with administrator access or your disk.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="downloads">Downloads and updates</PaperText>
            <PaperTextList>
                <li>Panels, the packages they use, and server daemon updates are signed with the Paperboard release key. The daemon checks the signature, and the file's SHA-256 checksum, before it installs anything. An unsigned or changed file is refused.</li>
                <li>Release builds of Paperboard download from the Paperboard registry. An environment variable alone cannot point them anywhere else.</li>
                <li>Desktop app updates are checked against the SHA-512 checksum in the update feed on <PaperCode>i.paperboard.dev</PaperCode>, not against the release key.</li>
                <li>The Windows and macOS builds have no developer signature from Microsoft or Apple, which is why both warn you when you first open them.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="backups">Backups</PaperText>
            <PaperText preset="body" as="p">
                Backups are plain compressed archives, not encrypted. Anyone who can read the backup location can read the panel's files and settings in it.
                See <PaperLink href="/docs/paperboard/backups/">Backups</PaperLink>.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/troubleshooting/">Troubleshooting</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
