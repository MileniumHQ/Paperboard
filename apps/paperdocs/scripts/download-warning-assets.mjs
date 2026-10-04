// Every document gets the same lazy download controller and PaperUI styles.
// The controller works for static anchors, Solid controls and shadow DOM.
export function withDownloadWarningAssets(html) {
    if (!html.includes('</head>') || !html.includes('</body>')) {
        throw new Error('paperdocs: download guidance requires a complete HTML document');
    }
    const sharedStyles = html.includes('href="/site.css"') ? '' : '<link rel="stylesheet" href="/site.css" />\n        ';
    return html
        .replace('</head>', `${sharedStyles}<link rel="stylesheet" href="/css/download-warning.css" />\n    </head>`)
        .replace('</body>', '<script type="module" src="/js/download-warning.js"></script>\n    </body>');
}
