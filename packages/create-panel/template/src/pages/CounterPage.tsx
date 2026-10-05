import { createSignal } from "solid-js";
import { PaperFlex, PaperButton, PaperText } from "@mileniumhq/paperui";

export default function CounterPage() {
    const [count, setCount] = createSignal(0);

    return (
        <PaperFlex direction="column" gap="half" padding="full">
            <PaperText preset="title">Counter</PaperText>
            <PaperText size={8} weight={700}>
                {count()}
            </PaperText>
            <PaperFlex direction="row" gap="half">
                <PaperButton onClick={() => setCount((c) => c - 1)}>
                    Decrement
                </PaperButton>
                <PaperButton onClick={() => setCount((c) => c + 1)}>
                    Increment
                </PaperButton>
                <PaperButton variant="text" onClick={() => setCount(0)}>
                    Reset
                </PaperButton>
            </PaperFlex>
        </PaperFlex>
    );
}
