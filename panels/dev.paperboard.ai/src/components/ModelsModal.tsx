import { PaperModal } from "@paperboard-dev/paperui";
import ModelBrowser from "./ModelBrowser";

/** The model picker: one modal with installed models first, then the library. */
export default function ModelsModal(props: { open: boolean; onClose: () => void; onPick: (ref: string) => void }) {
    return (
        <PaperModal open={props.open} onClose={props.onClose} title="Models" size="large">
            <ModelBrowser mode="pick" manage onPick={props.onPick} />
        </PaperModal>
    );
}
