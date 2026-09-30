import type { CustomScheme } from "electron";

/**
 * The page's address. The page and the app API share its origin, so the page fetches the API
 * by path.
 */
const APP_URL = "wio://app/";

/**
 * The app's own scheme: standard, so it has an origin and relative URLs; secure, so the page is
 * a secure context; and able to `fetch` and stream.
 */
const APP_SCHEME: CustomScheme = {
  scheme: "wio",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
};

/**
 * Returns whether a URL is the app's own, on the page's origin.
 *
 * @param url - The URL.
 */
function isAppUrl(url: string) {
  const parsed = URL.parse(url);

  return parsed?.protocol === "wio:" && parsed.host === "app";
}

export { APP_SCHEME, APP_URL, isAppUrl };
