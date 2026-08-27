import { ext } from '../lib/browser';
import { buildAliasEmail, extractSiteHost, generateAliasLocalPart, hostToSiteSlug } from '../lib/alias';
import {
  CloudflareApiError,
  cloudflareErrorMessage,
  createOrEnsureAliasRouting,
  deleteAliasRouting,
  listAliasRecordsForDestination,
  mapCloudflareErrorCode,
  testCloudflareAccess
} from '../lib/cloudflare';
import type { RuntimeRequest, RuntimeResponse } from '../lib/messages';
import { addHistoryRecord, clearHistory, deleteHistoryRecord, getHistory, getSettings, mergeHistoryRecords } from '../lib/storage';
import type { ExtensionSettings } from '../lib/types';
import { isValidDomain, isValidEmail, sanitizeSettings, validateSettings } from '../lib/validation';

function invalidSettingsResponse(settings: ExtensionSettings): RuntimeResponse {
  const errors = validateSettings(settings);
  if (errors.length === 0) {
    return {
      ok: true,
      data: null
    };
  }

  return {
    ok: false,
    error: errors[0],
    code: 'INVALID_CONFIG'
  };
}

async function handleGenerateAlias(tabUrl?: string): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  if (!isValidDomain(settings.domain)) {
    return {
      ok: false,
      error: 'Domain in options is missing or invalid.',
      code: 'INVALID_CONFIG'
    };
  }

  const siteHost = extractSiteHost(tabUrl);
  const siteSlug = hostToSiteSlug(siteHost);
  const localPart = generateAliasLocalPart(siteSlug);
  const alias = buildAliasEmail(localPart, settings.domain);

  return {
    ok: true,
    data: {
      alias,
      siteHost,
      siteSlug
    }
  };
}

async function handleCreateCloudflareAlias(alias: string, destinationEmail?: string): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  const settingsValidation = invalidSettingsResponse({
    ...settings,
    destinationEmail: destinationEmail ?? settings.destinationEmail
  });
  if (!settingsValidation.ok) {
    return settingsValidation;
  }

  try {
    const status = await createOrEnsureAliasRouting(settings, alias, destinationEmail);
    return {
      ok: true,
      data: {
        status
      }
    };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }

    return {
      ok: false,
      error: cloudflareErrorMessage('API_ERROR'),
      code: 'API_ERROR'
    };
  }
}

async function handleDeleteCloudflareAlias(alias: string, destinationEmail?: string): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  const settingsValidation = invalidSettingsResponse({
    ...settings,
    destinationEmail: destinationEmail ?? settings.destinationEmail
  });
  if (!settingsValidation.ok) {
    return settingsValidation;
  }

  try {
    const status = await deleteAliasRouting(settings, alias, destinationEmail);
    return {
      ok: true,
      data: {
        status
      }
    };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }

    return {
      ok: false,
      error: cloudflareErrorMessage('API_ERROR'),
      code: 'API_ERROR'
    };
  }
}

async function handleTestCloudflare(): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  const settingsValidation = invalidSettingsResponse(settings);
  if (!settingsValidation.ok) {
    return settingsValidation;
  }

  try {
    await testCloudflareAccess(settings);
    return {
      ok: true,
      data: {
        ok: true
      }
    };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }

    return {
      ok: false,
      error: cloudflareErrorMessage(mapCloudflareErrorCode()),
      code: 'API_ERROR'
    };
  }
}

function canSyncHistory(settings: ExtensionSettings, destinationEmail?: string): destinationEmail is string {
  return Boolean(
    destinationEmail &&
      isValidEmail(destinationEmail) &&
      settings.accountId &&
      settings.zoneId &&
      settings.apiToken
  );
}

async function handleGetHistory(destinationEmail?: string): Promise<RuntimeResponse> {
  const items = await getHistory();
  const settings = sanitizeSettings(await getSettings());
  const normalizedDestination = destinationEmail?.trim().toLowerCase();

  if (!canSyncHistory(settings, normalizedDestination)) {
    return {
      ok: true,
      data: {
        items,
        sync: {
          attempted: false,
          imported: 0
        }
      }
    };
  }

  try {
    const syncedItems = await listAliasRecordsForDestination(settings, normalizedDestination);
    const existingAliases = new Set(items.map((item) => item.alias.trim().toLowerCase()));
    const imported = syncedItems.filter((item) => !existingAliases.has(item.alias)).length;
    const mergedItems = await mergeHistoryRecords(syncedItems);

    return {
      ok: true,
      data: {
        items: mergedItems,
        sync: {
          attempted: true,
          imported
        }
      }
    };
  } catch (error) {
    const message =
      error instanceof CloudflareApiError
        ? error.message
        : cloudflareErrorMessage(mapCloudflareErrorCode());

    return {
      ok: true,
      data: {
        items,
        sync: {
          attempted: true,
          imported: 0,
          error: message
        }
      }
    };
  }
}

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  switch (request.type) {
    case 'GENERATE_ALIAS':
      return handleGenerateAlias(request.tabUrl);
    case 'CREATE_CLOUDFLARE_ALIAS':
      return handleCreateCloudflareAlias(request.alias, request.destinationEmail);
    case 'DELETE_CLOUDFLARE_ALIAS':
      return handleDeleteCloudflareAlias(request.alias, request.destinationEmail);
    case 'SAVE_ALIAS_RECORD':
      await addHistoryRecord(request.record);
      return {
        ok: true,
        data: {
          saved: true
        }
      };
    case 'GET_HISTORY':
      return handleGetHistory(request.destinationEmail);
    case 'DELETE_HISTORY_RECORD': {
      const deleted = await deleteHistoryRecord(request.id);
      return {
        ok: true,
        data: {
          deleted
        }
      };
    }
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return {
        ok: true,
        data: {
          settings
        }
      };
    }
    case 'TEST_CLOUDFLARE':
      return handleTestCloudflare();
    case 'CLEAR_HISTORY':
      await clearHistory();
      return {
        ok: true,
        data: {
          cleared: true
        }
      };
    default:
      return {
        ok: false,
        error: 'Unknown message type.',
        code: 'UNKNOWN'
      };
  }
}

ext.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  void handleRequest(request)
    .then((response) => sendResponse(response))
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      sendResponse({
        ok: false,
        error: message,
        code: 'UNEXPECTED'
      });
    });

  return true;
});
