import {
    PaperCode,
    PaperFlex,
    PaperKbd,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ConnectDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Connect a computer</PaperText>
            <PaperText preset="body" as="p">
                Pair a computer running the Paperboard server daemon with your Paperboard app, using a 6-digit code the daemon shows.
                You pair each computer once. After that it stays in the rail and Paperboard reconnects to it on its own.
            </PaperText>
            <PaperText preset="body" as="p">
                If you can sign in to the computer over SSH, Paperboard does all of it for you, and installs the daemon there first if it isn&apos;t yet. See <PaperLink href="#over-ssh">Set it up over SSH</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="over-ssh">Set it up over SSH</PaperText>
            <PaperText preset="body" as="p">
                Select <b>Add Computer</b>, pick the computer or type its address under <b>Custom IP</b>, and select <b>Next</b>.
                When SSH answers there, <b>Setting Up</b> shows each step as it goes:
            </PaperText>
            <PaperTextList ordered>
                <li><b>Connecting.</b> Paperboard checks the computer&apos;s SSH host key against the known_hosts files <PaperCode>ssh</PaperCode> reads (<PaperCode>~/.ssh/known_hosts</PaperCode>, the system&apos;s, and any your <PaperCode>~/.ssh/config</PaperCode> names). The first time, it adds the key to <PaperCode>~/.ssh/known_hosts</PaperCode>. If the key ever changes, setup stops and sends nothing.</li>
                <li><b>Signing in.</b> Paperboard tries your SSH agent and keys, as the user and keys in <PaperCode>~/.ssh/config</PaperCode>. If they don&apos;t work, it asks for a username and password. The password is used for this setup only and never saved.</li>
                <li><b>Looking for Paperboard Server.</b> If the Paperboard app is open on that computer, setup stops and asks for that computer&apos;s pairing code instead.</li>
                <li><b>Installing Paperboard Server.</b> Only if it isn&apos;t there. Paperboard downloads the signed release for that computer, checks its signature, copies it to <PaperCode>~/.local/bin/papercrane</PaperCode> (on Windows, <PaperCode>%LOCALAPPDATA%\Paperboard\bin</PaperCode>), and sets it up as a service. See below for what each system needs.</li>
                <li><b>Pairing.</b> Paperboard opens pairing there and pairs with the certificate the server names over SSH, so no other computer can answer in its place.</li>
            </PaperTextList>
            <PaperTextList>
                <li>On Linux, the service runs as your account. Paperboard turns on lingering so it keeps running after you sign out, using your password with <PaperCode>sudo</PaperCode> if it needs to. If it can&apos;t, Paperboard says so once the computer is added. Signed in as root, the service is a system service that starts at boot and runs as root, so every panel on that computer runs as root too. Sign in as your own account to avoid that.</li>
                <li>On macOS, with a password, the service starts at boot. Signed in with a key, it runs while you are signed in to that Mac.</li>
                <li>On Windows, the account has to be an administrator, because the service starts at boot. For other accounts, setup asks for the pairing code instead.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                To skip SSH, select <b>Connect with pairing code</b> on the <b>Setting Up</b> step, then follow the steps below. It&apos;s there while setup runs, while it asks for a password, and after it stops.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>The server daemon is running on the other computer. See <PaperLink href="/docs/paperboard/server-daemon/">Install the server daemon</PaperLink>.</li>
                <li>Both computers are on a network you trust. The pairing step itself is not encrypted.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="show-a-pairing-code">1. Show a pairing code</PaperText>
            <PaperText preset="body" as="p">
                On the computer running the daemon, do one of these:
            </PaperText>
            <PaperTextList>
                <li>If the daemon's own screen is open in a terminal, press <PaperKbd>p</PaperKbd>. The screen shows <PaperCode>Pairing Code: 123 456</PaperCode>.</li>
                <li>If it runs as a service, or in another terminal, run <PaperCode>papercrane pair</PaperCode>.</li>
            </PaperTextList>
            <PaperCode block language="text">
{`$ papercrane pair
Pairing code: 821 480

In Paperboard on the other computer, press Add Computer and pick this computer,
or choose Custom IP and type 192.168.1.50:45464. Then enter the code.
Pair only on a network you trust; once paired, the connection is encrypted.

Waiting for a computer to pair... (Ctrl+C cancels)`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Leave it waiting. It prints <PaperCode>Paired with</PaperCode> and the name of your computer when pairing succeeds, then exits.
                Ctrl+C closes pairing again, so no code is left open.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="add-the-computer">2. Add the computer in Paperboard</PaperText>
            <PaperTextList ordered>
                <li>In Paperboard, select <b>Add Computer</b>, the plus button in the rail.</li>
                <li>On <b>Connect a Computer</b>, the computers Paperboard finds on your network are listed by name, with the address they were found at, such as <PaperCode>192.168.1.50:45464</PaperCode>. Once paired, Paperboard switches to the computer&apos;s <PaperCode>.local</PaperCode> name if it answers there. Select yours and then <b>Next</b>.</li>
                <li>If it is not listed, select <b>Custom IP</b>. On <b>Computer Details</b>, type its address in <b>Computer address</b>, and its port in <b>Server port</b> if it is not <PaperCode>45464</PaperCode>. The address and port as <PaperCode>papercrane pair</PaperCode> prints them, such as <PaperCode>192.168.1.50:45464</PaperCode>, also go in <b>Computer address</b> whole. <b>Next</b> turns on once Paperboard reaches the computer.</li>
                <li>On <b>Pairing Verification</b>, type the code into <b>Pairing code</b>, with or without the space.</li>
                <li>Select <b>Add Computer</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The computer appears in the rail under its own computer name, and Paperboard opens it. A computer paired before keeps the name it has; to change it, see <PaperLink href="#change-a-name">Change a computer&apos;s name</PaperLink>.
                Install panels on it from its <b>Panel Library</b>. See <PaperLink href="/docs/paperboard/panels/">Install and manage panels</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="addresses">How Paperboard finds the computer later</PaperText>
            <PaperText preset="body" as="p">
                Paperboard knows a paired computer by its certificate, not by its address, so a computer whose address changes stays paired.
            </PaperText>
            <PaperTextList>
                <li>When the computer answers to a <PaperCode>.local</PaperCode> name from this computer, Paperboard keeps that name, even if you paired it by IP address. It also keeps the IP address it last answered at, and tries both at once.</li>
                <li>When the computer gets a new IP address or port, Paperboard finds it on your network and connects to it there.</li>
                <li>A computer on another network, such as over a VPN, keeps the address you paired it at.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A name or address is only kept once the computer's own certificate answers there, so another computer on the network can't take its place.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="pairing-rules">How pairing is protected</PaperText>
            <PaperTextList>
                <li>A code works for one pairing. It stays valid until a computer pairs with it, or until pairing is cancelled.</li>
                <li>After a wrong code, that address must wait 5 seconds before the next try. From the third wrong code on, it waits 30 seconds.</li>
                <li>After 10 wrong codes, that address cannot pair until you start pairing again on the daemon.</li>
                <li>After 100 wrong codes in total, the daemon ends pairing. Start it again for a new code.</li>
                <li>While pairing, Paperboard saves the daemon's certificate. From then on it connects only to a daemon that shows that same certificate, and the connection is encrypted.</li>
                <li>A daemon that listens only on <PaperCode>127.0.0.1</PaperCode> serves no encryption, so Paperboard can't pair with it, and <PaperCode>papercrane pair</PaperCode> says so. Start it with <PaperCode>--host 0.0.0.0</PaperCode> to pair it over your network.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A daemon holds at most 200 paired computers.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="computer-info">The Computer Info page</PaperText>
            <PaperText preset="body" as="p">
                Select a computer in the rail, then the top entry of its sidebar, which shows its name and operating system.
                Its Computer Info page shows its address, what the computer is, its backup locations, the network ports its panels hold, and for a paired computer, <b>Forget Computer</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                The <b>System</b> section lists what Paperboard detected about the computer, and the sidebar entry is tinted in that system's color:
            </PaperText>
            <PaperTextList>
                <li><b>Operated by</b>: an autonomous agent working on the computer, such as Claude Duet, Claude Code on the web or Grok Bot.</li>
                <li><b>System</b>: what is built on the operating system, such as Omarchy on Arch, Raspberry Pi OS, Proxmox VE, TrueNAS, Unraid or Synology DSM.</li>
                <li><b>Operating system</b>: the distribution, macOS or Windows, with its version.</li>
                <li><b>Runs in</b>: ChromeOS (Linux on a Chromebook), WSL, GitHub Codespaces, a Docker or Podman container, or the cloud or hypervisor of a virtual machine.</li>
                <li><b>Motherboard</b>: the board of a desktop built from parts, such as an ASUS or MSI board. A laptop or prebuilt computer has none listed, since its board carries only a part number.</li>
                <li><b>Architecture</b>: x86-64 or ARM64.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A paired computer's details are read again each time Paperboard connects to it. Run <PaperCode>papercrane identify</PaperCode> on a computer to see what it reports.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="change-a-name">Change a computer&apos;s name</PaperText>
            <PaperText preset="body" as="p">
                Right-click the computer in the rail and choose <b>Change Name</b>, or select <b>Change Name</b> on its Computer Info page. Type the new name in <b>Name</b> and select <b>Save</b>.
                The name is Paperboard&apos;s label for the computer: it doesn&apos;t rename the machine itself, and pairing the computer again keeps it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="forget-a-computer">Forget a computer</PaperText>
            <PaperText preset="body" as="p">
                Right-click the computer in the rail and choose <b>Forget Computer</b>, or select <b>Forget Computer</b> on its Computer Info page. Confirm with <b>Forget Computer</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                Paperboard removes the computer from the rail and, if it can reach it, tells the daemon to drop this pairing.
                Panels on that computer keep running. To use it again, pair it again. Pairing a computer again keeps the name it has.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="remove-from-the-daemon">Remove a paired computer from the daemon</PaperText>
            <PaperText preset="body" as="p">
                To cut off a computer you no longer have, remove it on the daemon's screen: press <PaperKbd>r</PaperKbd>.
                With one paired computer, it is removed straight away. With more, type the number the screen lists it under.
                The daemon closes that computer's connection at once.
            </PaperText>
            <PaperText preset="body" as="p">
                A daemon running as a service has no screen. Stop the service, run <PaperCode>papercrane</PaperCode> in a terminal to remove the computer, press <PaperKbd>s</PaperKbd> to stop it, and start the service again.
                The commands to stop and start a service are on <PaperLink href="/docs/paperboard/run-as-service/#manage-the-service">Run the daemon as a service</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="when-a-computer-is-offline">When a computer is offline</PaperText>
            <PaperText preset="body" as="p">
                When a paired computer stops answering, its page shows <b>Connection Lost</b>. Paperboard looks for it on your network and keeps trying to reconnect, waiting up to 15 seconds between tries.
                Select <b>Attempt Reconnect</b> to try at once. The line under it gives the last error.
            </PaperText>
            <PaperText preset="body" as="p">
                Selecting a computer that does not answer at all opens <b>Can't reach</b> with the computer's name. Select <b>Try Again</b> once the daemon is running again.
                The errors are listed in <PaperLink href="/docs/paperboard/troubleshooting/#connecting">Troubleshooting</PaperLink>.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/run-as-service/">keep the daemon running as a service</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
