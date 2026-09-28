// Contact page data and mailto assembly. The site has no form backend: the form
// builds a mailto: URL and hands off to the visitor's own mail client, so a
// request never leaves their machine until they send it. CONTACT_EMAIL is the
// single address every contact path uses; change it in one place.

export const CONTACT_EMAIL = "contact@mileniumhq.com";

export interface ContactReason {
    value: string;
    label: string;
    /** Subject line segment used after the "[Paperboard]" prefix. */
    subject: string;
    /** Shown under the select to say what the message should include. */
    hint: string;
}

export const CONTACT_REASONS: ContactReason[] = [
    {
        value: "general",
        label: "General question",
        subject: "General question",
        hint: "Anything about Paperboard, Origami, or the project.",
    },
    {
        value: "privacy",
        label: "Privacy request (access, correct, or delete my data)",
        subject: "Privacy request",
        hint: "Say what you want to access, correct, or delete, and where you are writing from.",
    },
    {
        value: "bug",
        label: "Bug report",
        subject: "Bug report",
        hint: "Paperboard version, operating system, and the steps that reproduce it.",
    },
    {
        value: "panel",
        label: "Panel submission",
        subject: "Panel submission",
        hint: "Describe the panel and include a link to its source. Do not attach secrets.",
    },
    {
        value: "takedown",
        label: "Panel removal or takedown request",
        subject: "Takedown request",
        hint: "Name the panel and the rights or policy it infringes.",
    },
    {
        value: "security",
        label: "Security report",
        subject: "Security report",
        hint: "Describe the issue and how to reproduce it. Do not include live credentials.",
    },
    {
        value: "licensing",
        label: "Licensing or commercial use question",
        subject: "Licensing question",
        hint: "Say what you want to do and which part of the project it covers.",
    },
    {
        value: "other",
        label: "Something else",
        subject: "Contact",
        hint: "Tell us what this is about.",
    },
];

export interface ContactDraft {
    reason: string;
    name: string;
    email: string;
    message: string;
}

export interface ContactErrors {
    reason?: string;
    email?: string;
    message?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The form is the only way a visitor can reach us, so the checks are strict:
// a wrong reply address loses the request. Empty fields are what the submit
// handler reports; the same values drive the live invalid state.
export function validateContact(draft: ContactDraft): ContactErrors {
    const errors: ContactErrors = {};
    if (!draft.reason.trim()) {
        errors.reason = "Choose a reason for contacting us.";
    }
    if (!EMAIL_PATTERN.test(draft.email.trim())) {
        errors.email = "Enter an email address we can reply to.";
    }
    if (!draft.message.trim()) {
        errors.message = "Write a message.";
    }
    return errors;
}

export function hasContactErrors(errors: ContactErrors): boolean {
    return Object.values(errors).some(Boolean);
}

export function contactReason(value: string): ContactReason | undefined {
    return CONTACT_REASONS.find((reason) => reason.value === value);
}

export function contactSubject(reasonValue: string): string {
    return `[Paperboard] ${contactReason(reasonValue)?.subject ?? "Contact"}`;
}

export function buildMailto(draft: ContactDraft): string {
    const reason = contactReason(draft.reason);
    const name = draft.name.trim();
    const email = draft.email.trim();
    const message = draft.message.trim();
    const body = [
        `Reason: ${reason?.label ?? draft.reason}`,
        name ? `Name: ${name}` : undefined,
        `Reply to: ${email}`,
        "",
        message,
    ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    const subject = contactSubject(draft.reason);
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
