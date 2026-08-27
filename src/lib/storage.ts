import { ext } from './browser';
import type { AliasRecord, ExtensionSettings } from './types';
import { DEFAULT_SETTINGS, HISTORY_LIMIT } from './types';
import { sanitizeSettings } from './validation';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'aliasHistory';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await ext.storage.sync.get(SETTINGS_KEY);
  const raw = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...raw
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await ext.storage.sync.set({
    [SETTINGS_KEY]: sanitizeSettings(settings)
  });
}

export async function getHistory(): Promise<AliasRecord[]> {
  const result = await ext.storage.local.get(HISTORY_KEY);
  const raw = result[HISTORY_KEY] as AliasRecord[] | undefined;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw;
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

function parseCreatedAt(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeHistoryRecord(record: AliasRecord, existing?: AliasRecord): AliasRecord {
  return {
    id: existing?.id ?? record.id,
    alias: normalizeAlias(record.alias),
    destinationEmail: record.destinationEmail?.trim().toLowerCase() ?? existing?.destinationEmail,
    siteHost: existing?.siteHost ?? record.siteHost,
    siteSlug: existing?.siteSlug ?? record.siteSlug,
    createdAt: existing?.createdAt ?? record.createdAt,
    cloudflareStatus: record.cloudflareStatus,
    errorCode: record.errorCode ?? existing?.errorCode
  };
}

export async function addHistoryRecord(record: AliasRecord): Promise<void> {
  const current = await getHistory();
  const normalizedRecord = normalizeHistoryRecord(record);
  const deduped = current.filter((item) => normalizeAlias(item.alias) !== normalizedRecord.alias);
  const next = [normalizedRecord, ...deduped].slice(0, HISTORY_LIMIT);
  await ext.storage.local.set({
    [HISTORY_KEY]: next
  });
}

export async function mergeHistoryRecords(records: AliasRecord[]): Promise<AliasRecord[]> {
  if (records.length === 0) {
    return getHistory();
  }

  const current = await getHistory();
  const byAlias = new Map<string, AliasRecord>();

  for (const item of current) {
    byAlias.set(normalizeAlias(item.alias), normalizeHistoryRecord(item));
  }

  for (const item of records) {
    const alias = normalizeAlias(item.alias);
    const existing = byAlias.get(alias);
    byAlias.set(alias, normalizeHistoryRecord(item, existing));
  }

  const next = Array.from(byAlias.values())
    .sort((left, right) => parseCreatedAt(right.createdAt) - parseCreatedAt(left.createdAt))
    .slice(0, HISTORY_LIMIT);

  await ext.storage.local.set({
    [HISTORY_KEY]: next
  });

  return next;
}

export async function clearHistory(): Promise<void> {
  await ext.storage.local.set({
    [HISTORY_KEY]: []
  });
}

export async function deleteHistoryRecord(recordId: string): Promise<boolean> {
  const current = await getHistory();
  const next = current.filter((item) => item.id !== recordId);

  if (next.length === current.length) {
    return false;
  }

  await ext.storage.local.set({
    [HISTORY_KEY]: next
  });

  return true;
}
