import { describe, expect, test } from "bun:test";
import {
    buildMailto,
    CONTACT_EMAIL,
    CONTACT_REASONS,
    contactSubject,
    hasContactErrors,
    validateContact,
    type ContactDraft,
} from "../src/site/contact";
import { SITE_LINKS } from "../src/site/links";

const COMPLETE: ContactDraft = {
    reason: "privacy",
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "Please delete the log entry for 192.0.2.1.",
};

describe("contact reasons", () => {
    test("every reason is unique and fully described", () => {
        const values = CONTACT_REASONS.map((reason) => reason.value);
        expect(new Set(values).size).toBe(values.length);
        for (const reason of CONTACT_REASONS) {
            expect(reason.label.length).toBeGreaterThan(0);
            expect(reason.subject.length).toBeGreaterThan(0);
            expect(reason.hint.length).toBeGreaterThan(0);
        }
    });

    test("a privacy request is offered for data access and deletion", () => {
        const privacy = CONTACT_REASONS.find(
            (reason) => reason.value === "privacy",
        );
        expect(privacy).toBeDefined();
        expect(privacy?.label.toLowerCase()).toContain("delete");
    });
});

describe("validateContact", () => {
    test("accepts a complete draft without a name", () => {
        const errors = validateContact({ ...COMPLETE, name: "" });
        expect(hasContactErrors(errors)).toBe(false);
    });

    test("reports a missing reason, message, and reply address", () => {
        const errors = validateContact({
            reason: "",
            name: "",
            email: "",
            message: "   ",
        });
        expect(errors.reason).toBeDefined();
        expect(errors.email).toBeDefined();
        expect(errors.message).toBeDefined();
        expect(hasContactErrors(errors)).toBe(true);
    });

    test("rejects an email without a domain", () => {
        const errors = validateContact({ ...COMPLETE, email: "ada@example" });
        expect(errors.email).toBeDefined();
    });
});

describe("buildMailto", () => {
    test("addresses the published contact inbox", () => {
        expect(buildMailto(COMPLETE).startsWith(`mailto:${CONTACT_EMAIL}?`)).toBe(
            true,
        );
    });

    test("carries the reason subject, reply address, and message in the body", () => {
        const url = buildMailto(COMPLETE);
        const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
        expect(query.get("subject")).toBe("[Paperboard] Privacy request");

        const body = query.get("body") ?? "";
        expect(body).toContain("Reason: Privacy request (access, correct, or delete my data)");
        expect(body).toContain("Name: Ada Lovelace");
        expect(body).toContain("Reply to: ada@example.com");
        expect(body).toContain(COMPLETE.message);
    });

    test("omits the name line when none is given", () => {
        const url = buildMailto({ ...COMPLETE, name: "   " });
        const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
        expect(query.get("body") ?? "").not.toContain("Name:");
    });

    test("an unknown reason still produces a usable subject", () => {
        expect(contactSubject("nope")).toBe("[Paperboard] Contact");
    });
});

describe("footer link", () => {
    test("the shared site links point Contact at the prerendered page", () => {
        const contact = SITE_LINKS.find((link) => link.href === "/contact");
        expect(contact?.label).toBe("Contact");
    });
});
