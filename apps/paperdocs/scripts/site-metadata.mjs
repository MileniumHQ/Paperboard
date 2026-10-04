const origin = 'https://paperboard.dev';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** One metadata contract for marketing pages, docs, and the rest of the site. */
export function siteMetadata(page, path) {
    const url = origin + path;
    const image = origin + '/paperboard.png';
    const schema = {
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'WebSite', '@id': origin + '/#website', url: origin + '/', name: 'Paperboard' },
            { '@type': 'WebPage', '@id': url, url, name: page.title, description: page.description,
                isPartOf: { '@id': origin + '/#website' } },
        ],
    };
    return `<title>${escape(page.title)}</title>
        <meta name="description" content="${escape(page.description)}" />
        <link rel="canonical" href="${escape(url)}" />
        <link rel="icon" type="image/png" href="/paperboard.png" />
        <link rel="apple-touch-icon" href="/paperboard.png" />
        ${path === '/404.html' ? '<meta name="robots" content="noindex" />' : ''}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Paperboard" />
        <meta property="og:url" content="${escape(url)}" />
        <meta property="og:title" content="${escape(page.title)}" />
        <meta property="og:description" content="${escape(page.description)}" />
        <meta property="og:image" content="${image}" />
        <meta property="og:image:width" content="875" />
        <meta property="og:image:height" content="875" />
        <meta property="og:image:alt" content="Paperboard logo" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="${escape(page.title)}" />
        <meta name="twitter:description" content="${escape(page.description)}" />
        <meta name="twitter:image" content="${image}" />
        <meta name="twitter:image:alt" content="Paperboard logo" />
        <script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`;
}
