// A page that is only UI: state that lives and dies with the window.
import { createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperPageHeader, PaperText } from "@mileniumhq/paperui";

export default function CounterPage() {
    const [count, setCount] = createSignal(0);

    return (
        <>
            <PaperPageHeader icon="add" title="Counter" subtitle="State that lives in this window only" />
            <PaperCard>
                <PaperFlex direction="column" padding="full" gap="full" align="center">
                    <PaperText size={8} weight={700}>
                        {count()}
                    </PaperText>
                    <PaperFlex direction="row" gap="half">
                        <PaperButton onClick={() => setCount((c) => c - 1)}>Decrement</PaperButton>
                        <PaperButton onClick={() => setCount((c) => c + 1)}>Increment</PaperButton>
                        <PaperButton variant="text" onClick={() => setCount(0)}>
                            Reset
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
        </>
    );
}
