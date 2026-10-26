import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, test } from "vitest";
import { PaperSlidePage } from "../components/PaperSlidePage";
import { PaperModal } from "../components/PaperModal";

afterEach(cleanup);
const back = () => window.dispatchEvent(new Event("paperboard:back", { cancelable: true }));

test("system Back closes the modal before the phone page and releases the host at the root", () => {
    const [page, setPage] = createSignal(true);
    const [modal, setModal] = createSignal(false);
    render(() => <>
        <PaperSlidePage enabled open={page()} title="Panel" onBack={() => setPage(false)}>Panel content</PaperSlidePage>
        <PaperModal open={modal()} onClose={() => setModal(false)}>Confirm</PaperModal>
    </>);
    setModal(true);
    expect(back()).toBe(false);
    expect(modal()).toBe(false);
    expect(page()).toBe(true);
    expect(back()).toBe(false);
    expect(page()).toBe(false);
    expect(back()).toBe(true);
});

test("desktop pages do not claim Back and unmounting releases an open page", () => {
    const view = render(() => <PaperSlidePage enabled={false} open title="Desktop" onBack={() => { throw new Error("Desktop claimed Back"); }}>Content</PaperSlidePage>);
    expect(back()).toBe(true);
    view.unmount();
    const phone = render(() => <PaperSlidePage enabled open title="Phone" onBack={() => {}}>Content</PaperSlidePage>);
    expect(back()).toBe(false);
    phone.unmount();
    expect(back()).toBe(true);
});
