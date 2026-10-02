// the fixed panel CSP (bun test): panels are first-party, so there is no
// per-panel egress declaration. Scripts stay locked to the document; the
// network directives do not pretend to restrict a first-party panel.
import { describe, it, expect } from "bun:test";
import { buildPanelCsp } from "../papercrane/panelNet";

const directive = (csp: string, name: string): string =>
    csp.split(";").find((d) => d.trim().startsWith(`${name} `))!.trim();

describe("buildPanelCsp", () => {
    it("is one policy, independent of any manifest", () => {
        const csp = buildPanelCsp();
        expect(directive(csp, "connect-src")).toContain("https:");
        expect(directive(csp, "img-src")).toContain("https:");
    });

    it("keeps scripts locked to the served document", () => {
        const csp = buildPanelCsp();
        expect(directive(csp, "script-src")).toBe("script-src 'self'");
        expect(csp).not.toContain("'unsafe-eval'");
    });

    it("allows panel assets, sibling origins and loopback daemon traffic", () => {
        const csp = buildPanelCsp();
        expect(directive(csp, "default-src")).toContain("panel:");
        expect(directive(csp, "connect-src")).toContain("ws://127.0.0.1:*");
        expect(directive(csp, "img-src")).toContain("http://*.paperboard.localhost:*");
    });
});
