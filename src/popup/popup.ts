import { ext, hasCloudflareAccess } from '../lib/browser';
import type { AliasRecord, CloudflareStatus, ExtensionSettings } from '../lib/types';
import { sendRuntimeMessage } from '../lib/messages';
import { initializeThemeToggle } from '../lib/theme';
import { isValidDomain, isValidEmail, normalizeDomain, sanitizeSettings } from '../lib/validation';

const siteHint = document.querySelector<HTMLParagraphElement>('#siteHint');
const statusNode = document.querySelector<HTMLParagraphElement>('#status');
const aliasValueNode = document.querySelector<HTMLElement>('#aliasValue');
const generateButton = document.querySelector<HTMLButtonElement>('#generateBtn');
const fillButton = document.querySelector<HTMLButtonElement>('#fillBtn');
const destinationRouteInput = document.querySelector<HTMLInputElement>('#destinationRouteInput');
const customAliasInput = document.querySelector<HTMLInputElement>('#customAliasInput');
const createCustomAliasButton = document.querySelector<HTMLButtonElement>('#createCustomAliasBtn');
const historyList = document.querySelector<HTMLUListElement>('#historyList');
const refreshHistoryButton = document.querySelector<HTMLButtonElement>('#refreshHistoryBtn');
const themeToggleButton = document.querySelector<HTMLButtonElement>('#themeToggle');

let latestAlias = '';
let latestDestinationEmail = '';
let latestSiteHost = 'manual';
let latestSiteSlug = 'manual';
let configuredDomain = '';
let configuredDefaultDestinationEmail = '';

const CUSTOM_LOCAL_PART_REGEX = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i;
type AliasSource = 'generated' | 'custom';

function setStatus(message: string): void {
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function setAliasValue(alias: string): void {
  latestAlias = alias;
  if (aliasValueNode) {
    aliasValueNode.textContent = alias || '-';
  }

  if (fillButton) {
    fillButton.disabled = !alias;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function getActiveTabUrl(): Promise<string | undefined> {
  const tab = await getActiveTab();
  return tab?.url;
}

function renderHistory(items: AliasRecord[]): void {
  if (!historyList) {
    return;
  }

  historyList.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No aliases yet.';
    historyList.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 12)) {
    const line = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'history-item-head';

    const alias = document.createElement('code');
    alias.textContent = item.alias;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ghost history-delete';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      void handleDeleteHistoryRecord(item);
    });

    head.appendChild(alias);
    head.appendChild(deleteButton);

    const details = document.createElement('span');
    const date = new Date(item.createdAt).toLocaleString();
    const destination = item.destinationEmail ? ` -> ${item.destinationEmail}` : '';
    details.textContent = `${item.siteSlug} • ${item.cloudflareStatus}${destination} • ${date}`;

    line.appendChild(head);
    line.appendChild(details);
    historyList.appendChild(line);
  }
}

async function handleDeleteHistoryRecord(record: AliasRecord): Promise<void> {
  const cloudflareDelete = await sendRuntimeMessage({
    type: 'DELETE_CLOUDFLARE_ALIAS',
    alias: record.alias,
    destinationEmail: record.destinationEmail
  });

  if (!cloudflareDelete.ok) {
    setStatus(`Unable to delete on Cloudflare: ${cloudflareDelete.error}`);
    return;
  }

  const historyDelete = await sendRuntimeMessage({
    type: 'DELETE_HISTORY_RECORD',
    id: record.id
  });

  if (!historyDelete.ok) {
    setStatus(`Unable to delete alias: ${historyDelete.error}`);
    return;
  }

  if (historyDelete.data.deleted && cloudflareDelete.data.status === 'deleted') {
    setStatus('Alias deleted from Cloudflare and history.');
  } else if (historyDelete.data.deleted) {
    setStatus('Alias removed from history. No Cloudflare rule was found.');
  } else {
    setStatus('Alias already removed.');
  }

  await loadHistory();
}

function getHistoryDestinationEmail(): string | undefined {
  const candidate = destinationRouteInput?.value.trim().toLowerCase() || configuredDefaultDestinationEmail;
  return candidate && isValidEmail(candidate) ? candidate : undefined;
}

async function loadHistory(showSyncStatus = false): Promise<void> {
  const response = await sendRuntimeMessage({
    type: 'GET_HISTORY',
    destinationEmail: getHistoryDestinationEmail()
  });
  if (!response.ok) {
    setStatus(response.error);
    return;
  }

  renderHistory(response.data.items);

  if (!showSyncStatus) {
    return;
  }

  if (response.data.sync.error) {
    setStatus(`Cloudflare sync failed: ${response.data.sync.error}`);
    return;
  }

  if (response.data.sync.attempted) {
    if (response.data.sync.imported > 0) {
      setStatus(`Cloudflare sync complete. ${response.data.sync.imported} alias(es) imported.`);
    } else {
      setStatus('Cloudflare sync complete. No new aliases found.');
    }
  }
}

async function copyAlias(alias: string): Promise<void> {
  await navigator.clipboard.writeText(alias);
}

function findEmailInputAndFill(alias: string): boolean {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email" i]'
    )
  );

  const target = candidates.find((input) => {
    if (input.disabled || input.readOnly) {
      return false;
    }

    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  if (!target) {
    return false;
  }

  target.focus();
  target.value = alias;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function fillEmailField(alias: string): Promise<boolean> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return false;
  }

  let result: chrome.scripting.InjectionResult<unknown>[];
  try {
    result = await ext.scripting.executeScript({
      target: { tabId: tab.id },
      func: findEmailInputAndFill,
      args: [alias]
    });
  } catch {
    return false;
  }

  return Boolean(result[0]?.result);
}

async function getSettings(): Promise<ExtensionSettings | null> {
  const response = await sendRuntimeMessage({ type: 'GET_SETTINGS' });
  if (!response.ok) {
    setStatus(response.error);
    return null;
  }

  return sanitizeSettings(response.data.settings);
}

function createHistoryRecord(status: CloudflareStatus, errorCode?: string): AliasRecord {
  return {
    id: crypto.randomUUID(),
    alias: latestAlias,
    destinationEmail: latestDestinationEmail,
    siteHost: latestSiteHost,
    siteSlug: latestSiteSlug,
    createdAt: new Date().toISOString(),
    cloudflareStatus: status,
    errorCode
  };
}

type DestinationResolution =
  | {
      ok: true;
      destinationEmail: string;
    }
  | {
      ok: false;
      error: string;
    };

function resolveDestinationEmail(): DestinationResolution {
  const fromPopup = destinationRouteInput?.value.trim().toLowerCase() ?? '';
  const destinationEmail = fromPopup || configuredDefaultDestinationEmail;

  if (!destinationEmail) {
    return {
      ok: false,
      error: 'Set a destination email in options or enter one in the popup.'
    };
  }

  if (!isValidEmail(destinationEmail)) {
    return {
      ok: false,
      error: 'Destination email is invalid.'
    };
  }

  return {
    ok: true,
    destinationEmail
  };
}

function setActionsEnabled(enabled: boolean): void {
  if (generateButton) {
    generateButton.disabled = !enabled;
  }
  if (createCustomAliasButton) {
    createCustomAliasButton.disabled = !enabled;
  }
}

type CustomAliasResolution =
  | {
      ok: true;
      alias: string;
    }
  | {
      ok: false;
      error: string;
    };

function resolveCustomAlias(inputValue: string, domain: string): CustomAliasResolution {
  const normalizedDomain = normalizeDomain(domain);
  const value = inputValue.trim().toLowerCase();

  if (!value) {
    return {
      ok: false,
      error: 'Enter an alias to recreate.'
    };
  }

  if (value.includes('@')) {
    const [localPart = '', domainPart = '', ...rest] = value.split('@');
    if (!localPart || !domainPart || rest.length > 0) {
      return {
        ok: false,
        error: 'Alias format is invalid.'
      };
    }

    const normalizedInputDomain = normalizeDomain(domainPart);
    if (normalizedInputDomain !== normalizedDomain) {
      return {
        ok: false,
        error: `Alias domain must be ${normalizedDomain}.`
      };
    }

    if (!CUSTOM_LOCAL_PART_REGEX.test(localPart)) {
      return {
        ok: false,
        error: 'Alias name can only use letters, numbers, ".", "_", "+", "-".'
      };
    }

    return {
      ok: true,
      alias: `${localPart}@${normalizedDomain}`
    };
  }

  if (!CUSTOM_LOCAL_PART_REGEX.test(value)) {
    return {
      ok: false,
      error: 'Alias name can only use letters, numbers, ".", "_", "+", "-".'
    };
  }

  return {
    ok: true,
    alias: `${value}@${normalizedDomain}`
  };
}

async function finalizeAliasFlow(
  alias: string,
  destinationEmail: string,
  siteHost: string,
  siteSlug: string,
  source: AliasSource
): Promise<void> {
  latestSiteHost = siteHost;
  latestSiteSlug = siteSlug;
  latestDestinationEmail = destinationEmail;
  setAliasValue(alias);

  let cloudflareStatus: CloudflareStatus = 'exists';
  let cloudflareError = '';
  let cloudflareErrorCode = '';
  let copyOk = true;

  const cloudflareResponse = (await hasCloudflareAccess())
    ? await sendRuntimeMessage({
        type: 'CREATE_CLOUDFLARE_ALIAS',
        alias,
        destinationEmail
      })
    : ({
        ok: false,
        error: 'access to api.cloudflare.com not granted (see options page)',
        code: 'MISSING_PERMISSION'
      } as const);

  if (cloudflareResponse.ok) {
    cloudflareStatus = cloudflareResponse.data.status;
  } else {
    cloudflareStatus = 'failed';
    cloudflareError = cloudflareResponse.error;
    cloudflareErrorCode = cloudflareResponse.code ?? 'API_ERROR';
  }

  try {
    await copyAlias(alias);
  } catch {
    copyOk = false;
  }

  await sendRuntimeMessage({
    type: 'SAVE_ALIAS_RECORD',
    record: createHistoryRecord(cloudflareStatus, cloudflareErrorCode || undefined)
  });

  const aliasLabel = source === 'custom' ? 'Custom alias' : 'Alias';

  if (!copyOk && cloudflareStatus === 'failed') {
    setStatus(`${aliasLabel} ready but copy failed. Cloudflare: ${cloudflareError || 'error'}`);
  } else if (!copyOk) {
    setStatus(`${aliasLabel} ready but copy failed. Copy manually.`);
  } else if (cloudflareStatus === 'failed') {
    setStatus(`${aliasLabel} copied. Cloudflare: ${cloudflareError || 'error'}`);
  } else if (cloudflareStatus === 'created') {
    setStatus(`${aliasLabel} copied. Cloudflare routing updated.`);
  } else {
    setStatus(`${aliasLabel} copied. Cloudflare already configured.`);
  }

  await loadHistory();
}

async function handleGenerateFlow(): Promise<void> {
  if (!generateButton) {
    return;
  }

  setActionsEnabled(false);
  if (fillButton) {
    fillButton.disabled = true;
  }

  try {
    const tabUrl = await getActiveTabUrl();

    const aliasResponse = await sendRuntimeMessage({
      type: 'GENERATE_ALIAS',
      tabUrl
    });

    if (!aliasResponse.ok) {
      setStatus(aliasResponse.error);
      return;
    }

    const destination = resolveDestinationEmail();
    if (!destination.ok) {
      setStatus(destination.error);
      return;
    }

    await finalizeAliasFlow(
      aliasResponse.data.alias,
      destination.destinationEmail,
      aliasResponse.data.siteHost,
      aliasResponse.data.siteSlug,
      'generated'
    );
  } finally {
    setActionsEnabled(Boolean(configuredDomain));
    if (fillButton) {
      fillButton.disabled = !latestAlias;
    }
  }
}

async function handleCustomAliasFlow(): Promise<void> {
  if (!createCustomAliasButton || !customAliasInput) {
    return;
  }

  setActionsEnabled(false);
  if (fillButton) {
    fillButton.disabled = true;
  }

  try {
    if (!configuredDomain || !isValidDomain(configuredDomain)) {
      setStatus('Set a valid domain in options before creating a custom alias.');
      return;
    }

    const resolved = resolveCustomAlias(customAliasInput.value, configuredDomain);
    if (!resolved.ok) {
      setStatus(resolved.error);
      return;
    }

    const destination = resolveDestinationEmail();
    if (!destination.ok) {
      setStatus(destination.error);
      return;
    }

    await finalizeAliasFlow(resolved.alias, destination.destinationEmail, 'manual', 'custom', 'custom');
  } finally {
    setActionsEnabled(Boolean(configuredDomain));
    if (fillButton) {
      fillButton.disabled = !latestAlias;
    }
  }
}

async function bootstrap(): Promise<void> {
  const settings = await getSettings();
  if (!settings) {
    return;
  }

  const normalizedDomain = normalizeDomain(settings.domain);
  const hasValidDomain = isValidDomain(normalizedDomain);
  configuredDomain = normalizedDomain;
  configuredDefaultDestinationEmail = settings.destinationEmail.trim().toLowerCase();

  if (destinationRouteInput && configuredDefaultDestinationEmail) {
    destinationRouteInput.value = configuredDefaultDestinationEmail;
  }

  if (!hasValidDomain) {
    setActionsEnabled(false);
    setStatus('Set a valid domain in options before generating aliases.');
  } else {
    setActionsEnabled(true);
    setStatus('Ready.');
  }

  const tab = await getActiveTab();
  let host = '-';
  if (tab?.url) {
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = '-';
    }
  }
  if (siteHint) {
    siteHint.textContent = `Current site: ${host}`;
  }

  await loadHistory();
}

generateButton?.addEventListener('click', () => {
  void handleGenerateFlow();
});

createCustomAliasButton?.addEventListener('click', () => {
  void handleCustomAliasFlow();
});

customAliasInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void handleCustomAliasFlow();
  }
});

fillButton?.addEventListener('click', () => {
  if (!latestAlias) {
    setStatus('Generate an alias first.');
    return;
  }

  void fillEmailField(latestAlias).then((ok) => {
    if (ok) {
      setStatus('Email field filled.');
    } else {
      setStatus('No visible email field found on this page.');
    }
  });
});

refreshHistoryButton?.addEventListener('click', () => {
  void loadHistory(true);
});

destinationRouteInput?.addEventListener('change', () => {
  void loadHistory(true);
});

initializeThemeToggle(themeToggleButton);

void bootstrap();
