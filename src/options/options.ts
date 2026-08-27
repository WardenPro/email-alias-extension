import { requestCloudflareAccess } from '../lib/browser';
import { sendRuntimeMessage } from '../lib/messages';
import { getSettings, saveSettings } from '../lib/storage';
import { initializeThemeToggle } from '../lib/theme';
import type { ExtensionSettings } from '../lib/types';
import { sanitizeSettings, validateSettings } from '../lib/validation';

const form = document.querySelector<HTMLFormElement>('#settingsForm');
const statusNode = document.querySelector<HTMLParagraphElement>('#status');
const domainInput = document.querySelector<HTMLInputElement>('#domain');
const destinationEmailInput = document.querySelector<HTMLInputElement>('#destinationEmail');
const accountIdInput = document.querySelector<HTMLInputElement>('#accountId');
const zoneIdInput = document.querySelector<HTMLInputElement>('#zoneId');
const apiTokenInput = document.querySelector<HTMLInputElement>('#apiToken');
const testButton = document.querySelector<HTMLButtonElement>('#testBtn');
const clearHistoryButton = document.querySelector<HTMLButtonElement>('#clearHistoryBtn');
const themeToggleButton = document.querySelector<HTMLButtonElement>('#themeToggle');

function setStatus(message: string): void {
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function readSettingsFromForm(): ExtensionSettings {
  return {
    domain: domainInput?.value ?? '',
    destinationEmail: destinationEmailInput?.value ?? '',
    accountId: accountIdInput?.value ?? '',
    zoneId: zoneIdInput?.value ?? '',
    apiToken: apiTokenInput?.value ?? ''
  };
}

function fillForm(settings: ExtensionSettings): void {
  if (domainInput) {
    domainInput.value = settings.domain;
  }
  if (destinationEmailInput) {
    destinationEmailInput.value = settings.destinationEmail;
  }
  if (accountIdInput) {
    accountIdInput.value = settings.accountId;
  }
  if (zoneIdInput) {
    zoneIdInput.value = settings.zoneId;
  }
  if (apiTokenInput) {
    apiTokenInput.value = settings.apiToken;
  }
}

async function handleSave(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const settings = sanitizeSettings(readSettingsFromForm());
  const errors = validateSettings(settings);
  if (errors.length > 0) {
    setStatus(errors[0]);
    return;
  }

  await saveSettings(settings);

  if (!(await requestCloudflareAccess())) {
    setStatus('Settings saved, but access to api.cloudflare.com was denied. Grant it to create aliases.');
    return;
  }

  setStatus('Settings saved.');
}

async function handleTestCloudflare(): Promise<void> {
  const settings = sanitizeSettings(readSettingsFromForm());
  const errors = validateSettings(settings);
  if (errors.length > 0) {
    setStatus(errors[0]);
    return;
  }

  if (!(await requestCloudflareAccess())) {
    setStatus('Access to api.cloudflare.com is required to reach Cloudflare.');
    return;
  }

  setStatus('Testing Cloudflare API...');
  const response = await sendRuntimeMessage({ type: 'TEST_CLOUDFLARE' });
  if (!response.ok) {
    setStatus(`Cloudflare test failed: ${response.error}`);
    return;
  }

  setStatus('Cloudflare access OK.');
}

async function bootstrap(): Promise<void> {
  const settings = sanitizeSettings(await getSettings());
  fillForm(settings);
  setStatus('Ready.');
}

form?.addEventListener('submit', (event) => {
  void handleSave(event);
});

testButton?.addEventListener('click', () => {
  void handleTestCloudflare();
});

clearHistoryButton?.addEventListener('click', () => {
  void sendRuntimeMessage({ type: 'CLEAR_HISTORY' }).then((response) => {
    if (response.ok) {
      setStatus('History cleared.');
    } else {
      setStatus(`Unable to clear history: ${response.error}`);
    }
  });
});

initializeThemeToggle(themeToggleButton);

void bootstrap();
