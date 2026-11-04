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
                <li>On <b>Connect a Computer</b>, the computers Paperboard finds on your network are listed by name. Select yours and then <b>Next</b>.</li>
                <li>If it is not listed, select <b>Custom IP</b>. On <b>Computer Details</b>, type its address in <b>Computer address</b>, and its port in <b>Server port</b> if it is not <PaperCode>45464</PaperCode>. <b>Next</b> turns on once Paperboard reaches the computer.</li>
                <li>On <b>Pairing Verification</b>, type the code into <b>Pairing code</b>, with or without the space.</li>
                <li>Select <b>Add Computer</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The computer appears in the rail under its own computer name, and Paperboard opens it.
                Install panels on it from its <b>Panel Library</b>. See <PaperLink href="/docs/paperboard/panels/">Install and manage panels</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="pairing-rules">How pairing is protected</PaperText>
            <PaperTextList>
                <li>A code works for one pairing. It stays valid until a computer pairs with it, or until pairing is cancelled.</li>
                <li>After a wrong code, that address must wait 5 seconds before the next try. From the third wrong code on, it waits 30 seconds.</li>
                <li>After 10 wrong codes, that address cannot pair until you start pairing again on the daemon.</li>
                <li>After 100 wrong codes in total, the daemon ends pairing. Start it again for a new code.</li>
                <li>While pairing, Paperboard saves the daemon's certificate. From then on it connects only to a daemon that shows that same certificate, and the connection is encrypted.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A daemon holds at most 200 paired computers.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="computer-info">The Computer Info page</PaperText>
            <PaperText preset="body" as="p">
                Select a computer in the rail, then the top entry of its sidebar, which shows its name and operating system.
                Its Computer Info page shows its address, its backup locations, the network ports its panels hold, and for a paired computer, <b>Forget Computer</b>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="forget-a-computer">Forget a computer</PaperText>
            <PaperText preset="body" as="p">
                Right-click the computer in the rail and choose <b>Forget Computer</b>, or select <b>Forget Computer</b> on its Computer Info page. Confirm with <b>Forget Computer</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                Paperboard removes the computer from the rail and, if it can reach it, tells the daemon to drop this pairing.
                Panels on that computer keep running. To use it again, pair it again.
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
                When a paired computer stops answering, its page shows <b>Connection Lost</b> and Paperboard keeps trying to reconnect, waiting up to 15 seconds between tries.
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
