import { showError, type ActionFailure } from "@mileniumhq/paperui";

/** A createAction run's failure, said as a toast, not kept: `run("Couldn't save it", save, toastFailure)`. */
export const toastFailure = (failure: ActionFailure | null): void => void (failure && showError(failure.title, failure.message));
