// The smallest panel UI vite builds: one page, no SDK, for test/panelUi.test.ts.
// With PANEL_UI_HOLD set, the build touches the file it names as it starts and
// then holds for 20 s, so the test can stop the runner mid-build.
import { writeFileSync } from "node:fs";

const hold = process.env.PANEL_UI_HOLD;

export default {
    base: "./",
    plugins: [
        {
            name: "hold",
            async buildStart() {
                if (!hold) return;
                writeFileSync(hold, "");
                // quiet: the hold is the point, ended by the runner stopping the build
                await new Promise((resolve) => setTimeout(resolve, 20_000));
            },
        },
    ],
};
