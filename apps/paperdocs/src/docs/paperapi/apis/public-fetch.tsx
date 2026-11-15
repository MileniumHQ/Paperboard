import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PublicFetchDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">fetchPublic</PaperText>
            <PaperText preset="body" as="p">
                fetchPublic fetches a web address that came from untrusted input, such as a chat message, a flow's input or a model's answer, in a panel's service.
                It reaches the public internet only, never the computer the service runs on or the network it sits on, and it bounds the answer in bytes and the fetch in time.
            </PaperText>
            <PaperText preset="body" as="p">
                A page never loads such an address itself. The service fetches it with fetchPublic and hands the page the bytes.
                It runs in a service only, so it has its own import path, <PaperCode>@mileniumhq/paperapi/net</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { fetchPublic, PublicFetchError } from "@mileniumhq/paperapi/net";

try {
    const file = await fetchPublic(inputs.url, { maxBytes: 10 * 1024 * 1024 });
    await upload(file.body, file.contentType);
} catch (err) {
    // the message says why: "192.168.1.4 is a private or local address", "The file at example.com is over 10 MB"
    if (err instanceof PublicFetchError) throw new Error(\`Couldn't send the file: \${err.message}\`);
    throw err;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`fetchPublic(url: unknown, options: PublicFetchOptions): Promise<PublicFetchResponse>;
publicAddressRefusal(ip: string): string | null;

interface PublicFetchOptions {
    /** the most bytes the body may be */
    maxBytes: number;
    /** the whole fetch, redirects and body included (default 15000) */
    timeoutMs?: number;
    /** redirects followed (default 3) */
    maxRedirects?: number;
    /** the request's Accept header (default "*/*") */
    accept?: string;
    /** origins the caller already trusts, reached without the public-address rule */
    trustedOrigins?: string[];
    /** how a name is resolved (default the system's resolver) */
    lookup?: (host: string) => Promise<{ address: string }[]>;
    /** only https addresses, the first and every redirect */
    requireHttps?: boolean;
    /** how one GET is made (default Node's http and https) */
    dial?: PublicFetchDial;
}

/** one GET of url, dialed to address (the one checked) */
type PublicFetchDial = (address: string, url: URL, request: { accept: string; signal: AbortSignal }) => Promise<PublicFetchAnswer>;

interface PublicFetchAnswer {
    status: number;
    /** the status line's words, such as "Not Found", or "" */
    statusText: string;
    /** by lower-case name */
    headers: Record<string, string | string[] | undefined>;
    body: AsyncIterable<Uint8Array>;
    /** stops reading the body and drops the connection */
    close(): void;
}

interface PublicFetchResponse {
    /** the address the body came from, after redirects */
    url: string;
    status: number;
    /** the Content-Type the server sent, or "" */
    contentType: string;
    body: Uint8Array;
}

class PublicFetchError extends Error {
    readonly code: "invalid-url" | "refused" | "unreachable" | "bad-response" | "too-large" | "timeout";
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>publicAddressRefusal</PaperCode> is the rule on its own: why an IP address isn't a public one, or <PaperCode>null</PaperCode> when it is. Use it for a connection fetchPublic doesn't make, after resolving the name yourself.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Only <PaperCode>http</PaperCode> and <PaperCode>https</PaperCode> addresses with no user name or password are fetched.</li>
                <li>The name is resolved, and loopback, private, link-local, carrier-grade NAT, multicast, reserved and cloud metadata addresses are refused, along with this computer's own addresses and IPv6 addresses that carry any of them (such as <PaperCode>::ffff:127.0.0.1</PaperCode>).</li>
                <li>The connection is dialed to the address that was checked, so a second lookup can't send it somewhere else. The request still names the host, and an https certificate is checked for it.</li>
                <li>Each redirect is checked the same way before it is followed.</li>
                <li>A body over <PaperCode>maxBytes</PaperCode> is refused, by its declared length or once that many bytes have arrived.</li>
                <li>No cookies or credentials are sent. Only a 2xx answer resolves.</li>
                <li><PaperCode>requireHttps</PaperCode> refuses an <PaperCode>http</PaperCode> address before anything is dialed, and a redirect to one before it is followed. Use it for anything shown in a page, such as a picture a chat message names.</li>
                <li>
                    <PaperCode>dial</PaperCode> replaces how one GET is made. It is given the address that was checked and must connect there, naming <PaperCode>url</PaperCode>'s host, and it must end the connection when <PaperCode>signal</PaperCode> aborts.
                    A test passes its own to see which address each hop dialed without reaching the internet, or to reach a server whose certificate it made. Every rule above still applies to what it answers.
                </li>
                <li>
                    <PaperCode>trustedOrigins</PaperCode> is for a server the person set up themselves, or a test's server on loopback.
                    A redirect out of a trusted origin is checked like any other address. Never put an origin from untrusted input there.
                </li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>invalid-url</PaperCode></td><td>Not an <PaperCode>http</PaperCode> or <PaperCode>https</PaperCode> address (not <PaperCode>https</PaperCode> with <PaperCode>requireHttps</PaperCode>), or one with a user name or password. A redirect to one fails the same way.</td></tr>
                    <tr><td><PaperCode>refused</PaperCode></td><td>The address, or one it redirected to, is on this computer or its local network.</td></tr>
                    <tr><td><PaperCode>unreachable</PaperCode></td><td>The name didn't resolve, or the server couldn't be reached.</td></tr>
                    <tr><td><PaperCode>bad-response</PaperCode></td><td>An answer other than 2xx, a redirect with nowhere to go, or more redirects than <PaperCode>maxRedirects</PaperCode>.</td></tr>
                    <tr><td><PaperCode>too-large</PaperCode></td><td>The body is over <PaperCode>maxBytes</PaperCode>.</td></tr>
                    <tr><td><PaperCode>timeout</PaperCode></td><td>The whole fetch took longer than <PaperCode>timeoutMs</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="pictures">Pictures for a page</PaperText>
            <PaperCode block language="tsx">
{`createPictureFetch(options: PictureFetchOptions): PictureFetch;

interface PictureFetchOptions {
    /** the most bytes one picture may be */
    maxBytes: number;
    /** each fetch, redirects included (default 15000) */
    timeoutMs?: number;
    /** redirects followed (default 3) */
    maxRedirects?: number;
    /** what the kept pictures add up to, in characters of their data: addresses (default 16 M) */
    keepChars?: number;
    /** pictures fetched at once (default 6) */
    atOnce?: number;
}

/** the picture at url as a data: address; from names the source in a failure */
type PictureFetch = (url: URL, request: { from: string; trustedOrigins?: string[] }) => Promise<string>;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A page never loads a picture someone else chose, such as an avatar, an add-on's icon or a map's thumbnail. The service fetches it with the function <PaperCode>createPictureFetch</PaperCode> returns and hands the page a <PaperCode>data:</PaperCode> address.
                Make one per service and check that the address is on a host its source keeps pictures on before asking for it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createPictureFetch } from "@mileniumhq/paperapi/net";

const pictures = createPictureFetch({ maxBytes: 1024 * 1024, timeoutMs: 10_000 });

getPicture: (_ctx, input) => {
    const url = new URL(String(input?.url));
    if (url.host !== "cdn.example.com") throw new Error(\`Pictures come from cdn.example.com, not \${url.host}\`);
    return pictures(url, { from: "the CDN" });
},`}
            </PaperCode>
            <PaperTextList>
                <li>Each picture is fetched with fetchPublic, asking for <PaperCode>image/*</PaperCode>, under every rule above.</li>
                <li>Its type is read from its bytes: PNG, JPEG, GIF, WebP and AVIF, whatever the server called it. SVG has no signature and is taken when the server names it <PaperCode>image/svg+xml</PaperCode>; an <PaperCode>{"<img>"}</PaperCode> draws it without running anything in it. Anything else is refused: <PaperCode>&lt;from&gt; sent text/html where a picture should be, and it isn't one</PaperCode>.</li>
                <li>A fetch that fails throws <PaperCode>Couldn't load the picture from &lt;from&gt;: &lt;why&gt;</PaperCode>.</li>
                <li>Pictures are kept by address, the oldest going first past <PaperCode>keepChars</PaperCode>. Asks for a picture being fetched share its fetch. A failure isn't kept, so the next ask tries again.</li>
                <li>At most <PaperCode>atOnce</PaperCode> fetches run at a time, so a page of a hundred pictures asks no harder than a browser would.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
