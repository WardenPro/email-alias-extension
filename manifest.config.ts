import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ExtensionTarget = 'chrome' | 'firefox';

export const EXTENSION_TARGETS: ExtensionTarget[] = ['chrome', 'firefox'];

export function resolveTarget(value: string | undefined): ExtensionTarget {
  if (value === 'firefox' || value === 'chrome') {
    return value;
  }

  if (value) {
    throw new Error(`Unknown extension target "${value}". Use one of: ${EXTENSION_TARGETS.join(', ')}.`);
  }

  return 'chrome';
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
    version: string;
  };

  return pkg.version;
}

const GECKO_ID = 'email-alias-studio@warden696.github.io';

export function buildManifest(target: ExtensionTarget): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'Email Alias Studio',
    short_name: 'Alias Studio',
    version: packageVersion(),
    description:
      'Generate, recreate, and manage email aliases for your domain with Cloudflare Email Routing.',
    // Single 128px source; declaring smaller sizes for it trips AMO's icon
    // validation, and both browsers downscale on their own.
    icons: {
      '128': 'icon.png'
    },
    permissions: ['storage', 'activeTab', 'scripting', 'clipboardWrite'],
    host_permissions: ['https://api.cloudflare.com/client/v4/*'],
    action: {
      default_title: 'Email Alias Studio',
      default_popup: 'popup.html',
      default_icon: {
        '128': 'icon.png'
      }
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true
    }
  };

  if (target === 'firefox') {
    // Firefox MV3 has no service workers; it runs an (optionally module) event page.
    manifest.background = {
      scripts: ['assets/background.js'],
      type: 'module'
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 128 = first ESR with MV3 module background scripts.
        strict_min_version: '128.0',
        // Nothing is collected by this extension: aliases and Cloudflare
        // credentials stay in extension storage and go only to the user's own
        // Cloudflare account. Newer Firefox/AMO require this to be explicit.
        data_collection_permissions: {
          required: ['none']
        }
      }
    };

    return manifest;
  }

  manifest.minimum_chrome_version = '114';
  manifest.background = {
    service_worker: 'assets/background.js',
    type: 'module'
  };

  return manifest;
}
