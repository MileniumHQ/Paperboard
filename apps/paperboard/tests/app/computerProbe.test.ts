import { describe, expect, test } from "bun:test";
import { checkProbeTarget } from "../../src/main/communication/papercrane/probeTarget";

// What the Add Computer wizard tells the person about what they typed:
// a bad host is a bad address, a bad port is a bad port, and neither is
// blamed on the other or quietly replaced by the default.
describe("computer probe target", () => {
    test("a bad port is named as one, and the host is not blamed", () => {
        for (const port of ["99999", "0", "abc", "-1", "45464.5", "1e3", "0x50", "", "  ", 70000, 0]) {
            expect(checkProbeTarget("1.2.3.4", port)).toEqual({ reachable: false, error: "That isn't a valid port. Type a whole number from 1 to 65535" });
        }
    });

    test("a malformed host is flagged as an address before its port is looked at", () => {
        for (const port of ["45464", "99999", "abc"]) {
            expect(checkProbeTarget("not an ip!", port)).toEqual({
                reachable: false,
                error: "That isn't a valid address. Type an IP address or a computer name",
                invalidAddress: true,
            });
        }
    });

    test("a valid host and port is accepted as typed, an IPv6 host included", () => {
        expect(checkProbeTarget("127.0.0.1", "45464")).toEqual({ port: 45464 });
        expect(checkProbeTarget("example.com", " 1 ")).toEqual({ port: 1 });
        expect(checkProbeTarget("::1", 65535)).toEqual({ port: 65535 });
    });
});
