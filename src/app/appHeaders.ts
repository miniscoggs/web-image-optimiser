/**
 * The headers every response to the desktop app's page gets, from the app API and from the
 * desktop's own protocol handler, which serves the page: no MIME sniffing, no referrer, and the
 * page's content security policy.
 */
const APP_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
} as const;

export default APP_HEADERS;
