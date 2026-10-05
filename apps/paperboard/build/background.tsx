import { renderToString } from "solid-js/web";
import { MarketingHeading } from "../../paperdocs/src/site/landing/MarketingHeading";
import { PaperIcon } from "../../../packages/paperui/src/components/PaperIcon";

export function renderBackground() {
    return renderToString(() => (
        <main class="dmg-canvas">
            <bg-overlay opacity="0.4" aria-hidden="true" />
            <div class="dmg-heading">
                <MarketingHeading level={1} text="Paperboard" size={64} />
            </div>
            <p class="hero-sub dmg-tagline">Do more with your computer</p>
            <PaperIcon class="dmg-arrow" aria-hidden="true">arrow_forward</PaperIcon>
            <p class="dmg-instruction">Drag Paperboard to Applications</p>
        </main>
    ));
}
