import { PaperCode, PaperFlex, PaperText } from "@mileniumhq/paperui";

export default function WorkshopMetadataDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Workshop metadata</PaperText>
            <PaperText preset="body">
                Modscan is Paperboard's separately operated Steam Workshop metadata service.
                Its source and operator instructions live in apps/modscan. It is not yet
                connected to the Game Server panel. The owner's Steam key belongs in the
                Worker's secret storage and must never be shipped with a panel.
            </PaperText>
            <PaperText preset="subheader">Service requests</PaperText>
            <PaperText preset="body">
                Call from a panel service process using GET. The allowlisted games are
                tmodloader, garrysmod, tf2, cs2 and palworld. Search accepts q, page and
                sort; item details accept up to 20 unique Workshop IDs. Unknown or
                duplicate parameters are rejected. Collections return direct child IDs.
            </PaperText>
            <PaperCode block language="text">{`GET https://panels.ariapis.com/modscan/v1/garrysmod/search?q=build&page=1&sort=relevance
GET https://panels.ariapis.com/modscan/v1/garrysmod/items?ids=123,456
GET https://panels.ariapis.com/modscan/v1/garrysmod/collections/123`}</PaperCode>
            <PaperText preset="subheader">Presenting results</PaperText>
            <PaperText preset="body">
                Responses contain items, a search total and attribution metadata.
                Display Powered by Steam with its source link, the non-affiliation notice
                and the data disclaimer. Treat descriptions as untrusted text. Missing
                optional statistics or child lists are null. This service returns metadata,
                not mod downloads or executable content.
            </PaperText>
            <PaperText preset="body">
                Surface error messages to users. A 429 can indicate client throttling,
                Steam throttling or the shared upstream budget; use the error code to
                distinguish them. A 503 reports missing configuration or unavailable
                service infrastructure. Do not hide these failures or retry in a loop.
            </PaperText>
            <PaperText preset="subheader">Operating the service</PaperText>
            <PaperText preset="body">
                Before public use, follow apps/modscan/README.md for the Steam terms
                review, privacy and storage-country disclosures, user-facing terms,
                attribution and deployment instructions. Searches are cached for one
                minute and details for five minutes. A transactional Durable Object
                limits upstream calls across games and locations. Changing the durable
                counter identity resets protection and must be coordinated with usage.
            </PaperText>
        </PaperFlex>
    );
}
