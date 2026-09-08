export async function handle({ event, resolve }) {
  const token = event.cookies.get('konoha-web-token') || '';
  return resolve(event, {
    transformPageChunk: ({ html }) => {
      if (token && html.includes('</head>')) {
        return html.replace('</head>', `  <meta name="konoha-web-token" content="${token}">\n</head>`);
      }
      return html;
    }
  });
}
