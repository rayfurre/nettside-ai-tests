// ===================================================
// TEST: Ny bruker - registrering, generering og editor
// VERSION: 6.4 (robust dialog-lukking, verifisering)
// ===================================================

import { test, expect, Page, BrowserContext, FrameLocator } from '@playwright/test';
import { getDagensBedrift, genererUnikEpost } from './testdata';
import * as fs from 'fs';
import * as path from 'path';

// ===================================================
// Interfaces
// ===================================================

interface LogEntry {
  timestamp: string;
  type: 'error' | 'warning' | 'toast' | 'network' | 'step';
  message: string;
  details?: string;
}

interface TestResult {
  bedrift: string;
  epost: string;
  startTid: string;
  sluttTid: string;
  steg: StepResult[];
  logs: LogEntry[];
  kladdUrl: string | null;
  screenshots: string[];
}

interface StepResult {
  navn: string;
  status: 'OK' | 'FEILET' | 'HOPPET OVER';
  melding: string;
  tidBrukt: number;
}

// ===================================================
// Selektorer (data-testid)
// ===================================================

const SEL = {
  // Preview & Editor
  previewIframe:      '[data-testid="preview-iframe"]',
  editorIframe:       '[data-testid="editor-iframe"]',
  editButton:         '[data-testid="edit-button"]',
  saveChangesButton:  '[data-testid="save-changes-button"]',
  cancelEditButton:   '[data-testid="cancel-edit-button"]',
  hintText:           '[data-testid="hint-click-text"]',
  hintImages:         '[data-testid="hint-click-images"]',

  // Bilde-modal (hovedsiden)
  imageDialog:        '[data-testid="image-edit-dialog"]',
  tabUpload:          '[data-testid="tab-upload"]',
  tabUrl:             '[data-testid="tab-url"]',
  tabAi:              '[data-testid="tab-ai"]',
  aiPromptInput:      '[data-testid="ai-prompt-input"]',
  enhancePromptBtn:   '[data-testid="enhance-prompt-button"]',
  generateAiBtn:      '[data-testid="generate-ai-button"]',
  useImageBtn:        '[data-testid="use-image-button"]',

  // ActionBar
  saveButton:         '[data-testid="save-button"]',
  updateButton:       '[data-testid="update-button"]',
  draftButton:        '[data-testid="draft-button"]',
  publishButton:      '[data-testid="publish-button"]',
};

// ===================================================
// Konstanter
// ===================================================

const IGNORED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'doubleclick.net',
];

const IGNORED_URL_PATTERNS = [
  '/rest/v1/project_history',
  '/rest/v1/deployment_issues',
];

// ===================================================
// Hjelpefunksjoner
// ===================================================

function isIgnoredUrl(url: string): boolean {
  if (IGNORED_DOMAINS.some(domain => url.includes(domain))) return true;
  if (IGNORED_URL_PATTERNS.some(pattern => url.includes(pattern))) return true;
  return false;
}

async function setupMonitoring(page: Page, logs: LogEntry[]): Promise<void> {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      const text = msg.text();
      if (isIgnoredUrl(text) || isIgnoredUrl(msg.location().url || '')) return;
      logs.push({ timestamp: new Date().toISOString(), type: type as 'error' | 'warning', message: text, details: msg.location().url });
    }
  });
  page.on('pageerror', (error) => {
    logs.push({ timestamp: new Date().toISOString(), type: 'error', message: `JS Error: ${error.message}`, details: error.stack });
  });
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !isIgnoredUrl(url)) {
      logs.push({ timestamp: new Date().toISOString(), type: 'network', message: `HTTP ${status}: ${url}`, details: response.statusText() });
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (isIgnoredUrl(url)) return;
    logs.push({ timestamp: new Date().toISOString(), type: 'network', message: `Request failed: ${url}`, details: request.failure()?.errorText });
  });
}

async function collectToasts(page: Page, logs: LogEntry[]): Promise<void> {
  const selectors = ['[data-sonner-toast]', '[role="alert"]', '[role="status"]', '.toast'];
  for (const selector of selectors) {
    try {
      const toasts = await page.locator(selector).all();
      for (const toast of toasts) {
        const text = await toast.textContent().catch(() => null);
        if (text && text.trim()) {
          const existing = logs.find(l => l.type === 'toast' && l.message === text.trim());
          if (!existing) {
            logs.push({ timestamp: new Date().toISOString(), type: 'toast', message: text.trim() });
          }
        }
      }
    } catch {}
  }
}

function createTestImage(): string {
  const testImagePath = path.join('test-results', 'test-bilde.png');
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(testImagePath, pngBuffer);
  return path.resolve(testImagePath);
}

// ----- Editor-hjelpefunksjoner -----

async function enterEditMode(page: Page): Promise<boolean> {
  try {
    // Vent på at preview-iframe har innhold (Rediger vises bare da)
    await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 30000 });

    // Klikk "Rediger"-knappen i hovedsiden
    await expect(page.locator(SEL.editButton)).toBeVisible({ timeout: 10000 });
    await page.locator(SEL.editButton).click();

    // preview-iframe forsvinner, editor-iframe dukker opp
    await expect(page.locator(SEL.editorIframe)).toBeVisible({ timeout: 10000 });

    // Vent på EDITOR_READY (laste-overlay forsvinner, fallback 3s i appen)
    await page.waitForTimeout(4000);

    return true;
  } catch {
    return false;
  }
}

async function saveEditorChanges(page: Page): Promise<boolean> {
  try {
    const btn = page.locator(SEL.saveChangesButton);
    const visible = await btn.isVisible().catch(() => false);
    if (visible) {
      const disabled = await btn.isDisabled().catch(() => true);
      if (!disabled) {
        await btn.click();
        await page.waitForTimeout(3000);
        return true;
      }
      return true; // disabled = ingen endringer, OK
    }
    return false;
  } catch {
    return false;
  }
}

function getEditorIframe(page: Page): FrameLocator {
  return page.frameLocator(SEL.editorIframe);
}

async function openImageModal(page: Page): Promise<boolean> {
  try {
    const iframe = getEditorIframe(page);

    // Vent på at minst ett bilde er synlig i iframe
    await iframe.locator('img').first().waitFor({ state: 'visible', timeout: 10000 });

    // Klikk første synlige bilde > 50px
    const allImages = await iframe.locator('img').all();
    console.log(`   📷 Fant ${allImages.length} bilder i editor-iframe`);

    for (const img of allImages) {
      const visible = await img.isVisible().catch(() => false);
      if (!visible) continue;

      // Sjekk størrelse via boundingBox (mer pålitelig enn naturalWidth i iframe)
      const box = await img.boundingBox().catch(() => null);
      if (!box || box.width <= 50) continue;

      console.log(`   📷 Klikker bilde: ${Math.round(box.width)}x${Math.round(box.height)}`);
      await img.click();

      // Vent på modal i hovedsiden (ikke iframe)
      try {
        await expect(page.locator(SEL.imageDialog)).toBeVisible({ timeout: 5000 });
        return true;
      } catch {
        // Prøv neste bilde
        console.log('   ⚠️ Modal åpnet ikke, prøver neste bilde...');
        continue;
      }
    }

    console.log('   ❌ Ingen bilder åpnet modalen');
    return false;
  } catch (error) {
    console.log(`   ❌ openImageModal feil: ${error}`);
    return false;
  }
}

function printReport(result: TestResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 TESTRAPPORT - NETTSIDE.AI');
  console.log('='.repeat(70));
  console.log(`🏢 Bedrift: ${result.bedrift}`);
  console.log(`📧 E-post: ${result.epost}`);
  console.log(`🕐 Start: ${result.startTid}`);
  console.log(`🕐 Slutt: ${result.sluttTid}`);
  console.log('='.repeat(70));

  console.log('\n📋 STEG-OVERSIKT:');
  console.log('-'.repeat(70));
  for (const steg of result.steg) {
    const icon = steg.status === 'OK' ? '✅' : steg.status === 'FEILET' ? '❌' : '⏭️';
    console.log(`${icon} ${steg.navn} (${steg.tidBrukt}ms)`);
    console.log(`   ${steg.melding}`);
  }

  if (result.kladdUrl) { console.log(`\n🔗 KLADD-URL:\n   ${result.kladdUrl}`); }

  const errors = result.logs.filter(l => l.type === 'error');
  const networkErrors = result.logs.filter(l => l.type === 'network');
  const warnings = result.logs.filter(l => l.type === 'warning');
  const toasts = result.logs.filter(l => l.type === 'toast');

  if (errors.length > 0) { console.log(`\n❌ FEIL (${errors.length}):`); errors.forEach(e => console.log(`   - ${e.message}`)); }
  if (networkErrors.length > 0) { console.log(`\n🌐 NETTVERKSFEIL (${networkErrors.length}):`); networkErrors.forEach(e => console.log(`   - ${e.message}`)); }
  if (warnings.length > 0) { console.log(`\n⚠️ ADVARSLER (${warnings.length}):`); warnings.forEach(e => console.log(`   - ${e.message}`)); }
  if (toasts.length > 0) { console.log(`\n💬 TOAST-MELDINGER (${toasts.length}):`); toasts.forEach(e => console.log(`   - ${e.message}`)); }
  if (result.screenshots.length > 0) { console.log(`\n📸 SCREENSHOTS:`); result.screenshots.forEach(s => console.log(`   - ${s}`)); }

  const feilet = result.steg.filter(s => s.status === 'FEILET').length;
  const ok = result.steg.filter(s => s.status === 'OK').length;

  console.log('\n' + '='.repeat(70));
  if (feilet === 0) { console.log(`🎉 RESULTAT: ALLE ${ok} STEG FULLFØRT`); }
  else { console.log(`💥 RESULTAT: ${feilet} STEG FEILET, ${ok} STEG OK`); }
  console.log('='.repeat(70) + '\n');
}

// ===================================================
// HOVEDTEST
// ===================================================

test.describe('Nettside.ai - Komplett test', () => {

  test('Registrering, generering, kladd og editor', async ({ page, context }) => {
    const bedrift = getDagensBedrift();
    const unikEpost = genererUnikEpost(bedrift);
    const logs: LogEntry[] = [];

    const result: TestResult = {
      bedrift: bedrift.firmanavn,
      epost: unikEpost,
      startTid: new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' }),
      sluttTid: '',
      steg: [],
      logs: logs,
      kladdUrl: null,
      screenshots: []
    };

    await setupMonitoring(page, logs);

    // ========================================
    // STEG 1: Åpne app.nettside.ai
    // ========================================
    let stegStart = Date.now();
    try {
      await page.goto('/', { timeout: 60000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
      await expect(page.getByText('Firmanavn').first()).toBeVisible({ timeout: 30000 });
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 1: Åpne app.nettside.ai', status: 'OK', melding: 'Siden lastet, skjema synlig', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg1-feil.png' }).catch(() => {});
      result.screenshots.push('steg1-feil.png');
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 1: Åpne app.nettside.ai', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 2: Fyll ut skjema
    // ========================================
    stegStart = Date.now();
    try {
      await page.getByPlaceholder('Navnet på din bedrift').fill(bedrift.firmanavn);
      await page.getByPlaceholder(/Skriv kort hva dere gjør/i).fill(bedrift.forretningside);
      await page.getByPlaceholder('Fornavn').fill(bedrift.fornavn);
      await page.getByPlaceholder('Etternavn').fill(bedrift.etternavn);
      await page.getByPlaceholder('din@epost.no').fill(unikEpost);
      await page.getByPlaceholder('Minst 6 tegn').fill(bedrift.passord);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 2: Fyll ut skjema', status: 'OK', melding: 'Alle 6 felter utfylt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg2-feil.png' }).catch(() => {});
      result.screenshots.push('steg2-feil.png');
      result.steg.push({ navn: 'Steg 2: Fyll ut skjema', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 3: Klikk Lagre (ActionBar)
    // ========================================
    stegStart = Date.now();
    try {
      await expect(page.locator(SEL.saveButton)).toBeVisible({ timeout: 5000 });
      await page.locator(SEL.saveButton).click();
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 3: Klikk Lagre', status: 'OK', melding: 'Lagre-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg3-feil.png' }).catch(() => {});
      result.screenshots.push('steg3-feil.png');
      result.steg.push({ navn: 'Steg 3: Klikk Lagre', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 4: Sjekk progress-animasjon
    // ========================================
    stegStart = Date.now();
    let progressStartet = false;
    try {
      await page.waitForTimeout(2000);
      const progressSelectors = [
        '[role="progressbar"]', '.progress', '[data-state="loading"]',
        '.animate-pulse', '.animate-spin', '[class*="progress"]', '[class*="loading"]'
      ];
      for (const selector of progressSelectors) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        if (isVisible) { progressStartet = true; break; }
      }
      await collectToasts(page, logs);
      result.steg.push({
        navn: 'Steg 4: Sjekk progress',
        status: progressStartet ? 'OK' : 'FEILET',
        melding: progressStartet ? 'Progress startet' : 'Progress IKKE synlig',
        tidBrukt: Date.now() - stegStart
      });
      if (!progressStartet) {
        await page.screenshot({ path: 'test-results/steg4-ingen-progress.png' }).catch(() => {});
        result.screenshots.push('steg4-ingen-progress.png');
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg4-feil.png' }).catch(() => {});
      result.screenshots.push('steg4-feil.png');
      result.steg.push({ navn: 'Steg 4: Sjekk progress', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 5: Vent på generering (~3 min)
    // ========================================
    stegStart = Date.now();
    let genereringFullfort = false;
    try {
      const toastInterval = setInterval(async () => { await collectToasts(page, logs).catch(() => {}); }, 5000);
      const maxWait = 180000;
      const pollInterval = 3000;
      let elapsed = 0;

      while (!genereringFullfort && elapsed < maxWait) {
        // Sjekk Kladd-knappen i ActionBar
        const kladdVisible = await page.locator(SEL.draftButton).isVisible().catch(() => false);
        if (kladdVisible) { genereringFullfort = true; break; }

        // Sjekk om preview-iframe dukker opp
        const previewVisible = await page.locator(SEL.previewIframe).isVisible().catch(() => false);
        if (previewVisible) {
          await page.waitForTimeout(3000);
          const kladdNow = await page.locator(SEL.draftButton).isVisible().catch(() => false);
          if (kladdNow) { genereringFullfort = true; break; }
        }
        await page.waitForTimeout(pollInterval);
        elapsed += pollInterval;
      }

      clearInterval(toastInterval);
      await collectToasts(page, logs);
      result.steg.push({
        navn: 'Steg 5: Vent på generering',
        status: genereringFullfort ? 'OK' : 'FEILET',
        melding: genereringFullfort
          ? `Fullført etter ${Math.round((Date.now() - stegStart) / 1000)}s`
          : `Timeout etter ${Math.round(maxWait / 1000)}s`,
        tidBrukt: Date.now() - stegStart
      });
      const screenshotName = genereringFullfort ? 'steg5-generert.png' : 'steg5-timeout.png';
      await page.screenshot({ path: `test-results/${screenshotName}`, fullPage: true }).catch(() => {});
      result.screenshots.push(screenshotName);
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg5-feil.png', fullPage: true }).catch(() => {});
      result.screenshots.push('steg5-feil.png');
      result.steg.push({ navn: 'Steg 5: Vent på generering', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 6: Klikk Kladd (ActionBar)
    // ========================================
    stegStart = Date.now();
    try {
      const kladdBtn = page.locator(SEL.draftButton);
      await expect(kladdBtn).toBeVisible({ timeout: 5000 });
      await kladdBtn.click();
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 6: Klikk Kladd', status: 'OK', melding: 'Kladd-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg6-feil.png' }).catch(() => {});
      result.screenshots.push('steg6-feil.png');
      result.steg.push({ navn: 'Steg 6: Klikk Kladd', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 7: Hent kladd-URL
    // Kladd åpner en dialog med URL etter polling (opptil 90s)
    // ========================================
    stegStart = Date.now();
    try {
      // Vent på at kladd-dialogen vises med URL
      const urlPatterns = [
        /https:\/\/draft\.kundesider\.pages\.dev\/[a-zA-Z0-9-]+\/?/,
        /https:\/\/draft--vibe-kundesider\.netlify\.app\/[a-zA-Z0-9-]+\/?/,
      ];

      const maxUrlWait = 100000; // 100s (appen poller 45x2s = 90s)
      const urlPoll = 3000;
      let urlElapsed = 0;

      while (!result.kladdUrl && urlElapsed < maxUrlWait) {
        await page.waitForTimeout(urlPoll);
        urlElapsed += urlPoll;
        await collectToasts(page, logs);

        // Søk i sideinnholdet (inkl. dialog)
        const pageContent = await page.content();
        for (const pattern of urlPatterns) {
          const match = pageContent.match(pattern);
          if (match) { result.kladdUrl = match[0]; break; }
        }

        // Søk i lenker
        if (!result.kladdUrl) {
          const links = await page.locator('a[href*="draft"]').all();
          for (const link of links) {
            const href = await link.getAttribute('href');
            if (href && (href.includes('draft.kundesider.pages.dev') || href.includes('draft--vibe-kundesider'))) {
              result.kladdUrl = href; break;
            }
          }
        }

        // Søk i toasts
        if (!result.kladdUrl) {
          for (const log of logs) {
            for (const pattern of urlPatterns) {
              const match = log.message.match(pattern);
              if (match) { result.kladdUrl = match[0]; break; }
            }
            if (result.kladdUrl) break;
          }
        }
      }

      if (result.kladdUrl) {
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'OK', melding: `URL: ${result.kladdUrl} (${Math.round(urlElapsed / 1000)}s)`, tidBrukt: Date.now() - stegStart });
      } else {
        await page.screenshot({ path: 'test-results/steg7-ingen-url.png' }).catch(() => {});
        result.screenshots.push('steg7-ingen-url.png');
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'FEILET', melding: `Timeout etter ${Math.round(maxUrlWait / 1000)}s`, tidBrukt: Date.now() - stegStart });
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg7-feil.png' }).catch(() => {});
      result.screenshots.push('steg7-feil.png');
      result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 8: Verifiser kladd-URL (med retry)
    // ========================================
    stegStart = Date.now();
    if (result.kladdUrl) {
      try {
        const newPage = await context.newPage();
        const maxRetries = 24;
        const retryInterval = 5000;
        let finalStatus = 0;
        let bodyContent = '';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const response = await newPage.goto(result.kladdUrl, { timeout: 15000 }).catch(() => null);
          finalStatus = response?.status() || 0;
          if (finalStatus === 200) {
            bodyContent = await newPage.locator('body').innerHTML().catch(() => '');
            if (bodyContent.length > 500) break;
          }
          if (attempt < maxRetries) {
            console.log(`   ⏳ Kladd-URL HTTP ${finalStatus}, forsøk ${attempt}/${maxRetries}...`);
            await newPage.waitForTimeout(retryInterval);
          }
        }

        await newPage.screenshot({ path: 'test-results/steg8-kladd-side.png', fullPage: true }).catch(() => {});
        result.screenshots.push('steg8-kladd-side.png');

        if (finalStatus === 200 && bodyContent.length > 500) {
          result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'OK', melding: `HTTP ${finalStatus}, ${bodyContent.length} tegn (${Math.round((Date.now() - stegStart) / 1000)}s)`, tidBrukt: Date.now() - stegStart });
        } else {
          result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'FEILET', melding: `HTTP ${finalStatus}, ${bodyContent.length} tegn`, tidBrukt: Date.now() - stegStart });
        }
        await newPage.close();
      } catch (error) {
        result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
      }
    } else {
      result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'HOPPET OVER', melding: 'Ingen kladd-URL', tidBrukt: 0 });
    }

    // ================================================================
    //
    //  EDITOR-TESTER (steg 9-12)
    //  Bruker er innlogget, nettside er generert.
    //  Innhold redigeres i iframe (editor-iframe).
    //  Knapper og modaler er i hovedsiden.
    //  VIKTIG: Kladd-dialogen MÅ lukkes først!
    //
    // ================================================================

    // Lukk ALLE åpne dialoger (kladd-dialog blokkerer alt)
    stegStart = Date.now();
    try {
      // Prøv å lukke opptil 3 ganger
      for (let i = 0; i < 3; i++) {
        const dialogOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogOpen) break;

        console.log(`   🔲 Dialog åpen, forsøk ${i + 1} å lukke...`);

        // Prøv Lukk/Close-knapp
        const lukkBtn = page.locator('[role="dialog"] button:has-text("Lukk"), [role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("OK")').first();
        const lukkVisible = await lukkBtn.isVisible().catch(() => false);
        if (lukkVisible) {
          await lukkBtn.click();
          await page.waitForTimeout(1000);
          continue;
        }

        // Prøv X-knapp (Radix DialogClose)
        const closeX = page.locator('[role="dialog"] button[aria-label="Close"], [role="dialog"] button:has(svg)').first();
        const closeXVisible = await closeX.isVisible().catch(() => false);
        if (closeXVisible) {
          await closeX.click();
          await page.waitForTimeout(1000);
          continue;
        }

        // Siste utvei: Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
      }

      // Verifiser at dialog er lukket
      const stillOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
      await collectToasts(page, logs);

      result.steg.push({
        navn: 'Steg 8b: Lukk dialog',
        status: stillOpen ? 'FEILET' : 'OK',
        melding: stillOpen ? 'Dialog fortsatt åpen!' : 'Alle dialoger lukket',
        tidBrukt: Date.now() - stegStart
      });

      if (stillOpen) {
        await page.screenshot({ path: 'test-results/steg8b-dialog-aapen.png' }).catch(() => {});
        result.screenshots.push('steg8b-dialog-aapen.png');
      }
    } catch (error) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      result.steg.push({ navn: 'Steg 8b: Lukk dialog', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 9: Tekstredigering
    // ========================================

    // 9a: Aktiver redigeringsmodus
    stegStart = Date.now();
    let editModeActive = false;
    try {
      editModeActive = await enterEditMode(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg9a-redigeringsmodus.png' }).catch(() => {});
      result.screenshots.push('steg9a-redigeringsmodus.png');
      result.steg.push({
        navn: 'Steg 9a: Aktiver redigeringsmodus',
        status: editModeActive ? 'OK' : 'FEILET',
        melding: editModeActive ? 'Editor-iframe synlig' : 'Redigeringsmodus ikke aktivert',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg9a-feil.png' }).catch(() => {});
      result.screenshots.push('steg9a-feil.png');
      result.steg.push({ navn: 'Steg 9a: Aktiver redigeringsmodus', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 9b: Klikk overskrift inne i iframe og endre tekst
    stegStart = Date.now();
    const testTekst = `E2E Test ${Date.now()}`;
    try {
      if (!editModeActive) throw new Error('Redigeringsmodus ikke aktiv');

      const iframe = getEditorIframe(page);
      let headingClicked = false;
      for (const tag of ['h1', 'h2']) {
        const heading = iframe.locator(tag).first();
        const visible = await heading.isVisible().catch(() => false);
        if (visible) {
          await heading.click();
          await page.waitForTimeout(1500);
          headingClicked = true;
          break;
        }
      }
      if (!headingClicked) throw new Error('Ingen overskrift funnet i editor-iframe');

      await page.keyboard.press('Control+A');
      await page.keyboard.type(testTekst);
      await iframe.locator('body').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(2000);
      await collectToasts(page, logs);

      await page.screenshot({ path: 'test-results/steg9b-tekst-endret.png' }).catch(() => {});
      result.screenshots.push('steg9b-tekst-endret.png');
      result.steg.push({ navn: 'Steg 9b: Endre overskrift', status: 'OK', melding: `Tekst: "${testTekst}"`, tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg9b-feil.png' }).catch(() => {});
      result.screenshots.push('steg9b-feil.png');
      result.steg.push({ navn: 'Steg 9b: Endre overskrift', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 9c: Lagre endringer
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg9c-lagret.png' }).catch(() => {});
      result.screenshots.push('steg9c-lagret.png');
      result.steg.push({ navn: 'Steg 9c: Lagre tekstendring', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 9c: Lagre tekstendring', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 10: Bilde - Last opp
    // ========================================

    // 10a: Redigeringsmodus
    stegStart = Date.now();
    try {
      const alreadyEditing = await page.locator(SEL.editorIframe).isVisible().catch(() => false);
      if (!alreadyEditing) {
        // Etter lagring → normalvisning. Vent på preview, så enter edit igjen
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        editModeActive = await enterEditMode(page);
        if (!editModeActive) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      // Ekstra vent for at bilder i iframe skal laste
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (upload)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10a-feil.png' }).catch(() => {});
      result.screenshots.push('steg10a-feil.png');
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (upload)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10b: Klikk bilde i iframe → modal i hovedsiden
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('Bilde-modal åpnet ikke');
      await page.screenshot({ path: 'test-results/steg10b-modal.png' }).catch(() => {});
      result.screenshots.push('steg10b-modal.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10b-feil.png' }).catch(() => {});
      result.screenshots.push('steg10b-feil.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10c: Velg "Last opp"-fane og last opp
    stegStart = Date.now();
    try {
      await page.locator(SEL.tabUpload).click();
      await page.waitForTimeout(500);
      const testImagePath = createTestImage();
      await page.locator('input[type="file"]').first().setInputFiles(testImagePath);
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg10c-opplastet.png' }).catch(() => {});
      result.screenshots.push('steg10c-opplastet.png');
      result.steg.push({ navn: 'Steg 10c: Last opp bilde', status: 'OK', melding: 'Testbilde lastet opp', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10c-feil.png' }).catch(() => {});
      result.screenshots.push('steg10c-feil.png');
      result.steg.push({ navn: 'Steg 10c: Last opp bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10d: Bruk dette bildet
    stegStart = Date.now();
    try {
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 10d: Bruk bildet', status: 'OK', melding: 'Bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10d-feil.png' }).catch(() => {});
      result.screenshots.push('steg10d-feil.png');
      result.steg.push({ navn: 'Steg 10d: Bruk bildet', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10e: Lagre editor
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 10e: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 10e: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 11: Bilde - URL (Unsplash)
    // ========================================

    const testBildeUrl = 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop';

    // 11a: Redigeringsmodus
    stegStart = Date.now();
    try {
      const alreadyEditing = await page.locator(SEL.editorIframe).isVisible().catch(() => false);
      if (!alreadyEditing) {
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        const ok = await enterEditMode(page);
        if (!ok) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (URL)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11a-feil.png' }).catch(() => {});
      result.screenshots.push('steg11a-feil.png');
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (URL)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11b: Åpne bilde-modal
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('Modal åpnet ikke');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11b-feil.png' }).catch(() => {});
      result.screenshots.push('steg11b-feil.png');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11c: URL-fane og lim inn
    stegStart = Date.now();
    try {
      await page.locator(SEL.tabUrl).click();
      await page.waitForTimeout(1000);

      // Finn URL-input i dialogen
      const urlInput = page.locator(`${SEL.imageDialog} input[type="url"], ${SEL.imageDialog} input[placeholder*="URL"], ${SEL.imageDialog} input[placeholder*="http"]`).first();
      let filled = await urlInput.isVisible().catch(() => false);
      if (filled) {
        await urlInput.fill(testBildeUrl);
      } else {
        // Fallback
        const inputs = await page.locator(`${SEL.imageDialog} input`).all();
        for (const input of inputs) {
          const vis = await input.isVisible().catch(() => false);
          const type = await input.getAttribute('type').catch(() => '');
          if (vis && type !== 'file') { await input.fill(testBildeUrl); filled = true; break; }
        }
      }
      if (!filled) throw new Error('URL-input ikke funnet');
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'OK', melding: 'Unsplash-URL limt inn', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11c-feil.png' }).catch(() => {});
      result.screenshots.push('steg11c-feil.png');
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11d: Bruk bildet
    stegStart = Date.now();
    try {
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'OK', melding: 'Lagret', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11d-feil.png' }).catch(() => {});
      result.screenshots.push('steg11d-feil.png');
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11e: Lagre editor
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 11e: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 11e: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 12: Bilde - AI
    // ========================================

    // 12a: Redigeringsmodus
    stegStart = Date.now();
    try {
      const alreadyEditing = await page.locator(SEL.editorIframe).isVisible().catch(() => false);
      if (!alreadyEditing) {
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        const ok = await enterEditMode(page);
        if (!ok) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (AI)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12a-feil.png' }).catch(() => {});
      result.screenshots.push('steg12a-feil.png');
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (AI)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12b: Åpne bilde-modal
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('Modal åpnet ikke');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12b-feil.png' }).catch(() => {});
      result.screenshots.push('steg12b-feil.png');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12c: AI-fane → vent på beskrivelse
    stegStart = Date.now();
    try {
      await page.locator(SEL.tabAi).click();
      await page.waitForTimeout(2000);

      const promptInput = page.locator(SEL.aiPromptInput);
      const maxWait = 30000;
      const poll = 2000;
      let elapsed = 0;
      let ready = false;

      while (!ready && elapsed < maxWait) {
        const value = await promptInput.inputValue().catch(() => '');
        if (value.length > 10) {
          ready = true;
          console.log(`   ✅ AI-beskrivelse: "${value.substring(0, 60)}..."`);
          break;
        }
        await page.waitForTimeout(poll);
        elapsed += poll;
      }

      await page.screenshot({ path: 'test-results/steg12c-ai-beskrivelse.png' }).catch(() => {});
      result.screenshots.push('steg12c-ai-beskrivelse.png');
      result.steg.push({
        navn: 'Steg 12c: Vent på AI-beskrivelse',
        status: ready ? 'OK' : 'FEILET',
        melding: ready ? `Mottatt etter ${Math.round(elapsed / 1000)}s` : `Timeout`,
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12c-feil.png' }).catch(() => {});
      result.screenshots.push('steg12c-feil.png');
      result.steg.push({ navn: 'Steg 12c: Vent på AI-beskrivelse', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12d: Forbedre prompt
    stegStart = Date.now();
    try {
      const promptBefore = await page.locator(SEL.aiPromptInput).inputValue().catch(() => '');
      await expect(page.locator(SEL.enhancePromptBtn)).toBeVisible({ timeout: 5000 });
      await page.locator(SEL.enhancePromptBtn).click();
      console.log('   ⏳ Venter på forbedret prompt...');

      const maxWait = 15000;
      const poll = 2000;
      let elapsed = 0;
      let done = false;

      while (!done && elapsed < maxWait) {
        await page.waitForTimeout(poll);
        elapsed += poll;
        const after = await page.locator(SEL.aiPromptInput).inputValue().catch(() => '');
        if (after !== promptBefore && after.length > 10) {
          done = true;
          console.log(`   ✅ Forbedret: "${after.substring(0, 60)}..."`);
        }
      }

      await page.screenshot({ path: 'test-results/steg12d-forbedret.png' }).catch(() => {});
      result.screenshots.push('steg12d-forbedret.png');
      result.steg.push({
        navn: 'Steg 12d: Forbedre prompt',
        status: done ? 'OK' : 'FEILET',
        melding: done ? `Forbedret etter ${Math.round(elapsed / 1000)}s` : 'Timeout',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12d-feil.png' }).catch(() => {});
      result.screenshots.push('steg12d-feil.png');
      result.steg.push({ navn: 'Steg 12d: Forbedre prompt', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12e: Generer med AI
    stegStart = Date.now();
    try {
      const imgBefore = await page.locator(`${SEL.imageDialog} img`).first().getAttribute('src').catch(() => '');
      await expect(page.locator(SEL.generateAiBtn)).toBeVisible({ timeout: 5000 });
      await page.locator(SEL.generateAiBtn).click();
      console.log('   ⏳ Venter på AI-bildegenerering (30-90s)...');

      const maxWait = 90000;
      const poll = 3000;
      let elapsed = 0;
      let done = false;

      while (!done && elapsed < maxWait) {
        await page.waitForTimeout(poll);
        elapsed += poll;
        await collectToasts(page, logs);
        const imgAfter = await page.locator(`${SEL.imageDialog} img`).first().getAttribute('src').catch(() => '');
        if (imgAfter && imgAfter !== imgBefore && imgAfter.length > 20) {
          done = true;
          console.log(`   ✅ AI-bilde generert etter ${Math.round(elapsed / 1000)}s`);
        }
      }

      await page.screenshot({ path: 'test-results/steg12e-ai-bilde.png' }).catch(() => {});
      result.screenshots.push('steg12e-ai-bilde.png');
      result.steg.push({
        navn: 'Steg 12e: Generer med AI',
        status: done ? 'OK' : 'FEILET',
        melding: done ? `Generert etter ${Math.round(elapsed / 1000)}s` : `Timeout etter ${Math.round(maxWait / 1000)}s`,
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12e-feil.png' }).catch(() => {});
      result.screenshots.push('steg12e-feil.png');
      result.steg.push({ navn: 'Steg 12e: Generer med AI', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12f: Bruk AI-bilde
    stegStart = Date.now();
    try {
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'OK', melding: 'AI-bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12f-feil.png' }).catch(() => {});
      result.screenshots.push('steg12f-feil.png');
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12g: Lagre editor
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg12g-lagret.png' }).catch(() => {});
      result.screenshots.push('steg12g-lagret.png');
      result.steg.push({ navn: 'Steg 12g: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'AI-bilde lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 12g: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // FERDIG
    // ========================================
    result.sluttTid = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
    printReport(result);
    fs.writeFileSync('test-results/rapport.json', JSON.stringify(result, null, 2));

    const kritiskeFeil = result.steg.filter(s =>
      s.status === 'FEILET' &&
      (s.navn.includes('Steg 5') || s.navn.includes('Steg 8'))
    );
    if (kritiskeFeil.length > 0) {
      throw new Error(`Kritiske steg feilet: ${kritiskeFeil.map(s => s.navn).join(', ')}`);
    }
  });
});