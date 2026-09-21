// First-run onboarding page — a small 3-step wizard:
//   1. welcome + language choice
//   2. check the local helper / show install instructions if needed
//   3. done
//
// IMPORTANT: set this to wherever install.bat is actually hosted (e.g. a
// raw.githubusercontent.com URL or a GitHub Releases asset) before shipping.
// It's a single self-contained file — it embeds its own setup logic and
// only reaches out to GitHub at runtime for the two binaries (the native
// host and sing-box), after showing their names/sizes and asking to
// confirm — so nothing else needs to be hosted alongside it.
const INSTALLER_DOWNLOAD_URL = 'https://raw.githubusercontent.com/REPLACE_ME/REPLACE_ME/main/installer/install.bat';

const el = (id) => document.getElementById(id);

const stepEls = {
  welcome: el('stepWelcome'),
  setup: el('stepSetup'),
  done: el('stepDone'),
};
const dotEls = Array.from(document.querySelectorAll('.wizard-dot'));

let lang = 'en';
let pollTimer = null;
let connectedOnce = false;

function goToStep(name) {
  Object.entries(stepEls).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
  const order = ['welcome', 'setup', 'done'];
  const idx = order.indexOf(name);
  dotEls.forEach((dot, i) => {
    dot.classList.toggle('active', i === idx);
    dot.classList.toggle('done', i < idx);
  });
}

function applyI18n() {
  V2RayI18n.applyDocumentDirection(lang);
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
  el('appTitle').textContent = t('title');

  el('onboardWelcomeTitle').textContent = t('onboardWelcomeTitle');
  el('onboardWelcomeBody').textContent = t('onboardWelcomeBody');
  el('onboardLangLabel').textContent = t('onboardLangLabel');
  el('welcomeNextBtn').textContent = t('onboardNext');
  el('welcomeSkipBtn').textContent = t('onboardSkip');

  el('onboardTitle').textContent = t('onboardTitle');
  el('onboardIntro').textContent = t('onboardIntro');
  el('onboardChecking2').textContent = t('onboardChecking2');
  el('onboardStep1Title').textContent = t('onboardStep1Title');
  el('onboardStep1Body').textContent = t('onboardStep1Body');
  el('onboardDownloadBtn').textContent = t('onboardDownloadBtn');
  el('onboardStep2Title').textContent = t('onboardStep2Title');
  el('onboardStep2Body').textContent = t('onboardStep2Body');
  el('onboardStep3Title').textContent = t('onboardStep3Title');
  el('onboardStep3Body').textContent = t('onboardStep3Body');
  el('alreadyDoneLine').textContent = t('onboardAlreadyDone');
  el('setupBackBtn').textContent = t('onboardBack');
  el('setupNextBtn').textContent = t('onboardNext');

  el('onboardStatusOK').textContent = t('onboardStatusOK');
  el('openPopupBtn').textContent = t('onboardOpenPopup');

  renderPollingStatus('waiting');
}

function renderPollingStatus(kind) {
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
  const statusDot = el('statusDot');
  const statusLine = el('statusLine');
  statusDot.className = 'dot ' + (kind === 'ok' ? 'running' : kind === 'checking' ? 'stopped' : 'unreachable');
  if (kind === 'checking') {
    statusLine.textContent = t('onboardStatusChecking');
  } else if (kind === 'ok') {
    statusLine.textContent = t('onboardStatusOK');
  } else {
    statusLine.textContent = t('onboardStatusWaiting');
  }
}

async function checkHostOnce() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'checkNativeHost' });
    return !!(res && res.ok);
  } catch (e) {
    return false;
  }
}

async function pollLoop() {
  const ok = await checkHostOnce();
  if (ok) {
    connectedOnce = true;
    renderPollingStatus('ok');
    el('setupNextBtn').disabled = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } else {
    renderPollingStatus('waiting');
  }
}

// Runs when the user lands on step 2. Shows a brief "checking" state,
// then either the already-installed message or the download
// instructions (with live polling) depending on what it finds.
async function enterSetupStep() {
  el('checkingCard').hidden = false;
  el('setupSteps').hidden = true;
  el('alreadyDoneCard').hidden = true;
  el('setupNextBtn').disabled = true;

  const ok = await checkHostOnce();
  el('checkingCard').hidden = true;

  if (ok) {
    connectedOnce = true;
    el('alreadyDoneCard').hidden = false;
    el('setupNextBtn').disabled = false;
  } else {
    el('setupSteps').hidden = false;
    downloadBtnHref();
    renderPollingStatus('waiting');
    pollTimer = setInterval(pollLoop, 2500);
  }
}

function downloadBtnHref() {
  el('downloadBtn').href = INSTALLER_DOWNLOAD_URL;
}

function wireLangPicker() {
  const radios = document.querySelectorAll('input[name="lang"]');
  radios.forEach((r) => {
    r.checked = r.value === lang;
    r.addEventListener('change', async (e) => {
      lang = e.target.value;
      await V2RayI18n.setLanguage(lang);
      applyI18n();
    });
  });
}

async function init() {
  lang = await V2RayI18n.getLanguage();
  applyI18n();
  wireLangPicker();
  goToStep('welcome');

  el('welcomeNextBtn').addEventListener('click', () => {
    goToStep('setup');
    enterSetupStep();
  });
  el('welcomeSkipBtn').addEventListener('click', () => window.close());

  el('setupBackBtn').addEventListener('click', () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    goToStep('welcome');
  });
  el('setupNextBtn').addEventListener('click', () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    goToStep('done');
  });

  el('openPopupBtn').addEventListener('click', () => window.close());
}

init();
