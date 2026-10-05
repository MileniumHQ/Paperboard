import {
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperFlex,
    PaperInput,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { createSignal, For, Show } from "solid-js";
import {
    buildMailto,
    CONTACT_REASONS,
    contactReason,
    hasContactErrors,
    validateContact,
    type ContactDraft,
    type ContactErrors,
} from "../contact";
import styles from "../site.module.css";

// Client island for the contact page. Contact.tsx renders this same component
// during prerender so the fields exist without JavaScript; entry-client.tsx
// re-renders it into #site-contact, where the submit handler can build the
// mailto hand-off. There is no server endpoint: "submitting" opens the
// visitor's mail client addressed to CONTACT_EMAIL, and nothing is sent until
// they choose to send it.
export function ContactForm() {
    const [reason, setReason] = createSignal("");
    const [name, setName] = createSignal("");
    const [email, setEmail] = createSignal("");
    const [message, setMessage] = createSignal("");
    const [submitted, setSubmitted] = createSignal(false);

    const draft = (): ContactDraft => ({
        reason: reason(),
        name: name(),
        email: email(),
        message: message(),
    });

    // Errors stay hidden until the first submit so the form does not shout at
    // a visitor who has not finished typing.
    const errors = (): ContactErrors =>
        submitted() ? validateContact(draft()) : {};

    const hint = () => contactReason(reason())?.hint;

    const handleSubmit = (event: SubmitEvent) => {
        event.preventDefault();
        setSubmitted(true);
        if (hasContactErrors(validateContact(draft()))) return;
        // Hand off through a real anchor: the same navigation a user gets from
        // clicking a mailto link, without leaving the page if no handler is
        // registered for the scheme.
        const link = document.createElement("a");
        link.href = buildMailto(draft());
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
    };

    return (
        <PaperCard surface="front" padding="double">
            <form class={styles.contactForm} onSubmit={handleSubmit} noValidate>
                <div class={styles.field}>
                    <span class={styles.fieldLabel}>Reason for contact</span>
                    <PaperSelectMenu
                        name="reason"
                        value={reason()}
                        onValueChange={(value) => setReason(String(value))}
                        placeholder="Choose a reason for contact"
                        fullWidth
                    >
                        <For each={CONTACT_REASONS}>
                            {(item) => (
                                <PaperSelectMenuItem value={item.value}>
                                    {item.label}
                                </PaperSelectMenuItem>
                            )}
                        </For>
                    </PaperSelectMenu>
                    <Show when={hint()}>
                        <PaperText preset="caption" color="text-subtle">
                            {hint()}
                        </PaperText>
                    </Show>
                    <Show when={errors().reason}>
                        <PaperText
                            preset="caption"
                            class={styles.fieldError}
                            role="alert"
                        >
                            {errors().reason}
                        </PaperText>
                    </Show>
                </div>

                <div class={styles.field}>
                    <label class={styles.fieldLabel} for="contact-name">
                        Your name{" "}
                        <PaperText as="span" preset="caption" color="text-subtle">
                            (optional)
                        </PaperText>
                    </label>
                    <PaperInput
                        id="contact-name"
                        name="name"
                        value={name()}
                        onInput={(event) => setName(event.currentTarget.value)}
                        placeholder="Ada Lovelace"
                        fullWidth
                        autocomplete="name"
                    />
                </div>

                <div class={styles.field}>
                    <label class={styles.fieldLabel} for="contact-email">
                        Email address
                    </label>
                    <PaperInput
                        id="contact-email"
                        name="email"
                        type="email"
                        value={email()}
                        onInput={(event) => setEmail(event.currentTarget.value)}
                        placeholder="you@example.com"
                        invalid={Boolean(errors().email)}
                        fullWidth
                        autocomplete="email"
                    />
                    <Show when={errors().email}>
                        <PaperText
                            preset="caption"
                            class={styles.fieldError}
                            role="alert"
                        >
                            {errors().email}
                        </PaperText>
                    </Show>
                </div>

                <div class={styles.field}>
                    <label class={styles.fieldLabel} for="contact-message">
                        Message
                    </label>
                    <PaperInput
                        id="contact-message"
                        name="message"
                        multiline
                        rows={6}
                        value={message()}
                        onInput={(event) =>
                            setMessage(event.currentTarget.value)
                        }
                        invalid={Boolean(errors().message)}
                        placeholder="How can we help?"
                        fullWidth
                    />
                    <Show when={errors().message}>
                        <PaperText
                            preset="caption"
                            class={styles.fieldError}
                            role="alert"
                        >
                            {errors().message}
                        </PaperText>
                    </Show>
                </div>

                <PaperFlex direction="row" align="center" gap="full" wrap>
                    <PaperEffect variant="brand">
                        <PaperButton variant="brand" type="submit">
                            Open in mail app
                        </PaperButton>
                    </PaperEffect>
                    <PaperText preset="caption" color="text-subtle">
                        This opens your email client with everything filled
                        in. Nothing is sent until you press send.
                    </PaperText>
                </PaperFlex>
            </form>
        </PaperCard>
    );
}
