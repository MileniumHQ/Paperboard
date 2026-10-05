import { PaperLink, PaperPageHeader, PaperText } from "@mileniumhq/paperui";
import { CONTACT_EMAIL } from "../contact";
import { ContactForm } from "./ContactForm";
import styles from "../site.module.css";

// Contact page: a mailto form plus the direct address. The form is rendered
// here for the static response and re-rendered by src/site/entry-client.tsx
// into #site-contact so it can build the mailto hand-off.
export function Contact() {
    return (
        <>
            <PaperPageHeader
                icon="mail"
                title="Contact"
                subtitle="Reach the Paperboard team about privacy, panels, security, or anything else."
            />
            <div class={styles.stack}>
                <PaperText preset="body">
                    Paperboard and Origami are run by Milenium. Use the
                    form below and it will open your email client with the
                    details filled in, or write to us directly at{" "}
                    <PaperLink href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                    </PaperLink>
                    .
                </PaperText>
                <PaperText preset="caption" color="text-subtle">
                    We read every message. Do not include passwords or API
                    keys in a request.
                </PaperText>
                <div id="site-contact">
                    <ContactForm />
                </div>
            </div>
        </>
    );
}
