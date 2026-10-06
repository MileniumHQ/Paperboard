const origin = 'https://paperboard.dev';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** One metadata contract for marketing pages, docs, and the rest of the site. */
export function siteMetadata(page, path) {
    const url = origin + path;
    // A page with its own image (a blog post's hero) gets the large card;
    // everything else shares the square logo as a small card.
    const image = page.image ? new URL(page.image.src, origin).href : origin + '/paperboard.png';
    const imageAlt = page.image ? page.image.alt : 'Paperboard logo';
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
        <meta property="og:type" content="${page.image ? 'article' : 'website'}" />
        <meta property="og:site_name" content="Paperboard" />
        <meta property="og:url" content="${escape(url)}" />
        <meta property="og:title" content="${escape(page.title)}" />
        <meta property="og:description" content="${escape(page.description)}" />
        <meta property="og:image" content="${escape(image)}" />
        ${page.image ? '' : `<meta property="og:image:width" content="875" />
        <meta property="og:image:height" content="875" />`}
        <meta property="og:image:alt" content="${escape(imageAlt)}" />
        <meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" />
        <meta name="twitter:title" content="${escape(page.title)}" />
        <meta name="twitter:description" content="${escape(page.description)}" />
        <meta name="twitter:image" content="${escape(image)}" />
        <meta name="twitter:image:alt" content="${escape(imageAlt)}" />
        <script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`;
}
