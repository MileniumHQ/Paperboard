import { PaperFlex, PaperLink, PaperText } from "@paperboard-dev/paperui";
import { withBase } from "../utils/base";

export function NotFound() {
    return (
        <PaperFlex
            fullHeight
            fullWidth
            align="center"
            justify="center"
            direction="column"
            gap="threefourths"
            style={{ "min-height": "calc(100vh - 45px)" }}
        >
            <PaperText weight={900} size={17}>
                404
            </PaperText>
            <PaperText>
                You've wandered far and wide, and gotten nowhere.
            </PaperText>
            <PaperLink href={withBase("/")}>Go somewhere</PaperLink>
        </PaperFlex>
    );
}
