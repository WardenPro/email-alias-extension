declare const browser: typeof chrome | undefined;

/**
 * Cross-browser extension namespace.
 * Firefox exposes the promise-based APIs on `browser`, Chrome on `chrome`.
 */
export const ext: typeof chrome =
  typeof browser !== 'undefined' && browser?.runtime ? browser : chrome;

export const CLOUDFLARE_ORIGIN = 'https://api.cloudflare.com/client/v4/*';

/**
 * Chrome grants manifest host permissions at install time. Firefox MV3 treats
 * them as opt-in, so they have to be checked and requested from a user gesture.
 */
export async function hasCloudflareAccess(): Promise<boolean> {
  try {
    return await ext.permissions.contains({ origins: [CLOUDFLARE_ORIGIN] });
  } catch {
    return true;
  }
}

export async function requestCloudflareAccess(): Promise<boolean> {
  if (await hasCloudflareAccess()) {
    return true;
  }

  try {
    return await ext.permissions.request({ origins: [CLOUDFLARE_ORIGIN] });
  } catch {
    return false;
  }
}
