// ===================================================
// TEST: Ny bruker - registrering, generering, editor og betaling
// VERSION: 7.3 (crash-proof: alle steg i try/catch, page-sjekk)
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
  previewIframe:      '[data-testid="preview-iframe"]',
  editorIframe:       '[data-testid="editor-iframe"]',
  editButton:         '[data-testid="edit-button"]',
  saveChangesButton:  '[data-testid="save-changes-button"]',
  cancelEditButton:   '[data-testid="cancel-edit-button"]',
  hintText:           '[data-testid="hint-click-text"]',
  hintImages:         '[data-testid="hint-click-images"]',
  imageDialog:        '[data-testid="image-edit-dialog"]',
  tabUpload:          '[data-testid="tab-upload"]',
  tabUrl:             '[data-testid="tab-url"]',
  tabAi:              '[data-testid="tab-ai"]',
  aiPromptInput:      '[data-testid="ai-prompt-input"]',
  enhancePromptBtn:   '[data-testid="enhance-prompt-button"]',
  generateAiBtn:      '[data-testid="generate-ai-button"]',
  useImageBtn:        '[data-testid="use-image-button"]',
  saveButton:         '[data-testid="save-button"]',
  updateButton:       '[data-testid="update-button"]',
  draftButton:        '[data-testid="draft-button"]',
  publishButton:      '[data-testid="publish-button"]',
  closeDraftDialog:   '[data-testid="close-draft-dialog"]',
};

// ===================================================
// Konstanter
// ===================================================

const IGNORED_DOMAINS = ['google-analytics.com','googletagmanager.com','analytics.google.com','doubleclick.net','draft.kundesider.pages.dev','draft--vibe-kundesider.netlify.app'];
const IGNORED_CONSOLE_PATTERNS = ['Failed to load resource', 'favicon.ico'];
const IGNORED_URL_PATTERNS = ['/rest/v1/project_history','/rest/v1/deployment_issues','draft.kundesider.pages.dev','draft--vibe-kundesider.netlify.app'];

// ===================================================
// Hjelpefunksjoner
// ===================================================

/** Sjekk om page fortsatt er åpen */
function isPageAlive(page: Page): boolean {
  try { return !page.isClosed(); } catch { return false; }
}

function isIgnoredUrl(url: string): boolean {
  if (IGNORED_DOMAINS.some(d => url.includes(d))) return true;
  if (IGNORED_URL_PATTERNS.some(p => url.includes(p))) return true;
  return false;
}

async function setupMonitoring(page: Page, logs: LogEntry[]): Promise<void> {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      const text = msg.text();
      if (isIgnoredUrl(text) || isIgnoredUrl(msg.location().url || '')) return;
      if (IGNORED_CONSOLE_PATTERNS.some(p => text.includes(p))) return;
      logs.push({ timestamp: new Date().toISOString(), type: type as 'error' | 'warning', message: text, details: msg.location().url });
    }
  });
  page.on('pageerror', (error) => {
    logs.push({ timestamp: new Date().toISOString(), type: 'error', message: `JS Error: ${error.message}`, details: error.stack });
  });
  page.on('response', (response) => {
    const s = response.status(); const u = response.url();
    if (s >= 400 && !isIgnoredUrl(u)) logs.push({ timestamp: new Date().toISOString(), type: 'network', message: `HTTP ${s}: ${u}`, details: response.statusText() });
  });
  page.on('requestfailed', (request) => {
    const u = request.url(); if (isIgnoredUrl(u)) return;
    logs.push({ timestamp: new Date().toISOString(), type: 'network', message: `Request failed: ${u}`, details: request.failure()?.errorText });
  });
}

async function collectToasts(page: Page, logs: LogEntry[]): Promise<void> {
  if (!isPageAlive(page)) return;
  for (const sel of ['[data-sonner-toast]', '[role="alert"]', '[role="status"]', '.toast']) {
    try {
      const toasts = await page.locator(sel).all();
      for (const t of toasts) {
        const text = await t.textContent().catch(() => null);
        if (text?.trim() && !logs.find(l => l.type === 'toast' && l.message === text.trim()))
          logs.push({ timestamp: new Date().toISOString(), type: 'toast', message: text.trim() });
      }
    } catch {}
  }
}

function createTestImage(): string {
  const p = path.join('test-results', 'test-bilde.png');
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(p, Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,0x00,0x00,0x02,0x00,0x01,0xE2,0x21,0xBC,0x33,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]));
  return path.resolve(p);
}

async function enterEditMode(page: Page): Promise<boolean> {
  try {
    if (!isPageAlive(page)) return false;
    await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(SEL.editButton)).toBeVisible({ timeout: 10000 });
    await page.locator(SEL.editButton).click();
    await expect(page.locator(SEL.editorIframe)).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const iframe = document.querySelector('[data-testid="editor-iframe"]') as HTMLIFrameElement;
      return iframe?.contentDocument?.readyState === 'complete';
    }, { timeout: 15000 });

    await page.waitForTimeout(3000);
    return true;
  } catch { return false; }
}

async function saveEditorChanges(page: Page): Promise<boolean> {
  try {
    if (!isPageAlive(page)) return false;
    const btn = page.locator(SEL.saveChangesButton);
    if (!(await btn.isVisible().catch(() => false))) return false;
    if (await btn.isDisabled().catch(() => true)) return true;
    await btn.click();
    await page.waitForTimeout(3000);
    return true;
  } catch { return false; }
}

function getEditorIframe(page: Page): FrameLocator {
  return page.frameLocator(SEL.editorIframe);
}

async function openImageModal(page: Page, skipCount: number = 0): Promise<boolean> {
  try {
    if (!isPageAlive(page)) return false;
    const iframe = getEditorIframe(page);
    await iframe.locator('img').first().waitFor({ state: 'visible', timeout: 10000 });
    const allImages = await iframe.locator('img').all();

    const clickable: typeof allImages = [];
    for (const img of allImages) {
      if (!(await img.isVisible().catch(() => false))) continue;
      const box = await img.boundingBox().catch(() => null);
      if (!box || box.width <= 50 || box.height <= 50) continue;
      clickable.push(img);
    }
    console.log(`   📷 Fant ${clickable.length} klikkbare bilder (skipCount=${skipCount})`);
    if (clickable.length === 0) return false;

    const idx = skipCount < clickable.length ? skipCount : 0;
    const order = [idx, ...Array.from({length: clickable.length}, (_, i) => i).filter(i => i !== idx)];
    for (const i of order) {
      if (!isPageAlive(page)) return false;
      const box = await clickable[i].boundingBox().catch(() => null);
      console.log(`   📷 Klikker bilde #${i}: ${box ? Math.round(box.width) + 'x' + Math.round(box.height) : '?'}`);

      await clickable[i].dispatchEvent('click');

      try {
        await expect(page.locator(SEL.imageDialog)).toBeVisible({ timeout: 5000 });
        return true;
      } catch {
        console.log('   ⚠️ dispatchEvent virket ikke, prøver .click()...');
        await clickable[i].click().catch(() => {});
        try {
          await expect(page.locator(SEL.imageDialog)).toBeVisible({ timeout: 3000 });
          return true;
        } catch {
          console.log('   ⚠️ Modal åpnet ikke, prøver neste bilde...');
        }
      }
    }
    console.log('   ❌ Ingen bilder åpnet modalen');
    return false;
  } catch (error) {
    console.log(`   ❌ openImageModal feil: ${error}`);
    return false;
  }
}

/** Sikker screenshot - feiler aldri */
async function safeScreenshot(page: Page, filePath: string, fullPage: boolean = false): Promise<void> {
  try {
    if (isPageAlive(page)) await page.screenshot({ path: filePath, fullPage });
  } catch {}
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
  for (const s of result.steg) {
    const i = s.status === 'OK' ? '✅' : s.status === 'FEILET' ? '❌' : '⏭️';
    console.log(`${i} ${s.navn} (${s.tidBrukt}ms)\n   ${s.melding}`);
  }
  if (result.kladdUrl) console.log(`\n🔗 KLADD-URL:\n   ${result.kladdUrl}`);
  const e = result.logs.filter(l => l.type === 'error');
  const n = result.logs.filter(l => l.type === 'network');
  const w = result.logs.filter(l => l.type === 'warning');
  const t = result.logs.filter(l => l.type === 'toast');
  if (e.length) { console.log(`\n❌ FEIL (${e.length}):`); e.forEach(x => console.log(`   - ${x.message}`)); }
  if (n.length) { console.log(`\n🌐 NETTVERKSFEIL (${n.length}):`); n.forEach(x => console.log(`   - ${x.message}`)); }
  if (w.length) { console.log(`\n⚠️ ADVARSLER (${w.length}):`); w.forEach(x => console.log(`   - ${x.message}`)); }
  if (t.length) { console.log(`\n💬 TOAST (${t.length}):`); t.forEach(x => console.log(`   - ${x.message}`)); }
  if (result.screenshots.length) { console.log(`\n📸 SCREENSHOTS:`); result.screenshots.forEach(x => console.log(`   - ${x}`)); }
  const feilet = result.steg.filter(x => x.status === 'FEILET').length;
  const ok = result.steg.filter(x => x.status === 'OK').length;
  console.log('\n' + '='.repeat(70));
  console.log(feilet === 0 ? `🎉 RESULTAT: ALLE ${ok} STEG FULLFØRT` : `💥 RESULTAT: ${feilet} STEG FEILET, ${ok} STEG OK`);
  console.log('='.repeat(70) + '\n');
}

// ===================================================
// HOVEDTEST
// ===================================================

test.describe('Nettside.ai - Komplett test', () => {

  test('Registrering, generering, kladd, editor og betaling', async ({ page, context }) => {
    const bedrift = getDagensBedrift();
    const unikEpost = genererUnikEpost(bedrift);
    const logs: LogEntry[] = [];
    const result: TestResult = {
      bedrift: bedrift.firmanavn, epost: unikEpost,
      startTid: new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' }),
      sluttTid: '', steg: [], logs, kladdUrl: null, screenshots: []
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
      await safeScreenshot(page, 'test-results/steg1-feil.png');
      result.screenshots.push('steg1-feil.png');
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 1: Åpne app.nettside.ai', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 2: Fyll ut skjema
    // ========================================
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.getByPlaceholder('Navnet på din bedrift').fill(bedrift.firmanavn);
      await page.getByPlaceholder(/Skriv kort hva dere gjør/i).fill(bedrift.forretningside);
      await page.getByPlaceholder('Fornavn').fill(bedrift.fornavn);
      await page.getByPlaceholder('Etternavn').fill(bedrift.etternavn);
      await page.getByPlaceholder('din@epost.no').fill(unikEpost);
      await page.getByPlaceholder('Minst 6 tegn').fill(bedrift.passord);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 2: Fyll ut skjema', status: 'OK', melding: 'Alle 6 felter utfylt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg2-feil.png');
      result.screenshots.push('steg2-feil.png');
      result.steg.push({ navn: 'Steg 2: Fyll ut skjema', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 3: Klikk Lagre (ActionBar)
    // ========================================
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.saveButton)).toBeVisible({ timeout: 5000 });
      await page.locator(SEL.saveButton).click();
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 3: Klikk Lagre', status: 'OK', melding: 'Lagre-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg3-feil.png');
      result.screenshots.push('steg3-feil.png');
      result.steg.push({ navn: 'Steg 3: Klikk Lagre', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 4: Sjekk progress-animasjon
    // ========================================
    stegStart = Date.now();
    let progressStartet = false;
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.waitForTimeout(2000);
      for (const sel of ['[role="progressbar"]','.progress','[data-state="loading"]','.animate-pulse','.animate-spin','[class*="progress"]','[class*="loading"]']) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) { progressStartet = true; break; }
      }
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 4: Sjekk progress', status: progressStartet ? 'OK' : 'FEILET', melding: progressStartet ? 'Progress startet' : 'Progress IKKE synlig', tidBrukt: Date.now() - stegStart });
      if (!progressStartet) { await safeScreenshot(page, 'test-results/steg4-ingen-progress.png'); result.screenshots.push('steg4-ingen-progress.png'); }
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg4-feil.png');
      result.screenshots.push('steg4-feil.png');
      result.steg.push({ navn: 'Steg 4: Sjekk progress', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 5: Vent på generering (~3 min)
    // ========================================
    stegStart = Date.now();
    let genereringFullfort = false;
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const ti = setInterval(async () => { await collectToasts(page, logs).catch(() => {}); }, 5000);
      const maxWait = 180000; let elapsed = 0;
      while (!genereringFullfort && elapsed < maxWait) {
        if (!isPageAlive(page)) break;
        if (await page.locator(SEL.draftButton).isVisible().catch(() => false)) { genereringFullfort = true; break; }
        if (await page.locator(SEL.previewIframe).isVisible().catch(() => false)) {
          await page.waitForTimeout(3000); elapsed += 3000;
          if (await page.locator(SEL.draftButton).isVisible().catch(() => false)) { genereringFullfort = true; break; }
        }
        await page.waitForTimeout(3000); elapsed += 3000;
      }
      clearInterval(ti); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 5: Vent på generering', status: genereringFullfort ? 'OK' : 'FEILET',
        melding: genereringFullfort ? `Fullført etter ${Math.round((Date.now()-stegStart)/1000)}s` : `Timeout etter ${Math.round(maxWait/1000)}s`, tidBrukt: Date.now() - stegStart });
      const sn = genereringFullfort ? 'steg5-generert.png' : 'steg5-timeout.png';
      await safeScreenshot(page, `test-results/${sn}`, true); result.screenshots.push(sn);
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg5-feil.png', true); result.screenshots.push('steg5-feil.png');
      result.steg.push({ navn: 'Steg 5: Vent på generering', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 6: Klikk Kladd (ActionBar)
    // ========================================
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.draftButton)).toBeVisible({ timeout: 5000 });
      await page.locator(SEL.draftButton).click();
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 6: Klikk Kladd', status: 'OK', melding: 'Kladd-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg6-feil.png'); result.screenshots.push('steg6-feil.png');
      result.steg.push({ navn: 'Steg 6: Klikk Kladd', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 7: Hent kladd-URL
    // ========================================
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const urlPatterns = [/https:\/\/draft\.kundesider\.pages\.dev\/[a-zA-Z0-9-]+\/?/, /https:\/\/draft--vibe-kundesider\.netlify\.app\/[a-zA-Z0-9-]+\/?/];
      const maxUrlWait = 100000; let urlElapsed = 0;
      while (!result.kladdUrl && urlElapsed < maxUrlWait) {
        if (!isPageAlive(page)) break;
        await page.waitForTimeout(3000); urlElapsed += 3000; await collectToasts(page, logs);
        const pc = await page.content().catch(() => '');
        for (const p of urlPatterns) { const m = pc.match(p); if (m) { result.kladdUrl = m[0]; break; } }
        if (!result.kladdUrl) {
          for (const link of await page.locator('a[href*="draft"]').all().catch(() => [])) {
            const h = await link.getAttribute('href').catch(() => null);
            if (h && (h.includes('draft.kundesider.pages.dev') || h.includes('draft--vibe-kundesider'))) { result.kladdUrl = h; break; }
          }
        }
        if (!result.kladdUrl) {
          for (const log of logs) { for (const p of urlPatterns) { const m = log.message.match(p); if (m) { result.kladdUrl = m[0]; break; } } if (result.kladdUrl) break; }
        }
      }
      if (result.kladdUrl) {
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'OK', melding: `URL: ${result.kladdUrl} (${Math.round(urlElapsed/1000)}s)`, tidBrukt: Date.now() - stegStart });
      } else {
        await safeScreenshot(page, 'test-results/steg7-ingen-url.png'); result.screenshots.push('steg7-ingen-url.png');
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'FEILET', melding: `Timeout etter ${Math.round(maxUrlWait/1000)}s`, tidBrukt: Date.now() - stegStart });
      }
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg7-feil.png'); result.screenshots.push('steg7-feil.png');
      result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 8: Verifiser kladd-URL (med retry)
    // ========================================
    stegStart = Date.now();
    if (result.kladdUrl) {
      try {
        const np = await context.newPage(); let finalStatus = 0; let body = '';
        for (let a = 1; a <= 24; a++) {
          const r = await np.goto(result.kladdUrl!, { timeout: 15000 }).catch(() => null);
          finalStatus = r?.status() || 0;
          if (finalStatus === 200) { body = await np.locator('body').innerHTML().catch(() => ''); if (body.length > 500) break; }
          if (a < 24) { console.log(`   ⏳ Kladd-URL HTTP ${finalStatus}, forsøk ${a}/24...`); await np.waitForTimeout(5000); }
        }
        await np.screenshot({ path: 'test-results/steg8-kladd-side.png', fullPage: true }).catch(() => {}); result.screenshots.push('steg8-kladd-side.png');
        result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: (finalStatus === 200 && body.length > 500) ? 'OK' : 'FEILET',
          melding: `HTTP ${finalStatus}, ${body.length} tegn (${Math.round((Date.now()-stegStart)/1000)}s)`, tidBrukt: Date.now() - stegStart });
        await np.close();
      } catch (error) {
        result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
      }
    } else {
      result.steg.push({ navn: 'Steg 8: Verifiser kladd-URL', status: 'HOPPET OVER', melding: 'Ingen kladd-URL', tidBrukt: 0 });
    }

    // ================================================================
    // EDITOR-TESTER (steg 9-12)
    // ================================================================

    // Lukk kladd-dialogen
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.waitForTimeout(2000);

      for (let attempt = 0; attempt < 3; attempt++) {
        if (!isPageAlive(page)) break;
        const dialogOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogOpen) break;

        console.log(`   🔲 Kladd-dialog åpen, forsøk ${attempt + 1}...`);

        const closeBtn = page.locator(SEL.closeDraftDialog);
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ force: true, timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
          continue;
        }

        await page.locator('body').click({ position: { x: 1, y: 1 }, force: true }).catch(() => {});
        await page.waitForTimeout(300).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000).catch(() => {});

        const stillThere = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
        if (stillThere) {
          await page.mouse.click(1, 1).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
        }
      }

      const stillOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 8b: Lukk dialog', status: stillOpen ? 'FEILET' : 'OK', melding: stillOpen ? 'Dialog fortsatt åpen!' : 'Dialog lukket', tidBrukt: Date.now() - stegStart });
      if (stillOpen) { await safeScreenshot(page, 'test-results/steg8b-dialog-aapen.png'); result.screenshots.push('steg8b-dialog-aapen.png'); }
    } catch (error) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
      result.steg.push({ navn: 'Steg 8b: Lukk dialog', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 9: Tekstredigering
    // ========================================
    stegStart = Date.now();
    let editModeActive = false;
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      editModeActive = await enterEditMode(page); await collectToasts(page, logs);
      await safeScreenshot(page, 'test-results/steg9a-redigeringsmodus.png'); result.screenshots.push('steg9a-redigeringsmodus.png');
      result.steg.push({ navn: 'Steg 9a: Aktiver redigeringsmodus', status: editModeActive ? 'OK' : 'FEILET', melding: editModeActive ? 'Editor-iframe synlig' : 'Ikke aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg9a-feil.png'); result.screenshots.push('steg9a-feil.png');
      result.steg.push({ navn: 'Steg 9a: Aktiver redigeringsmodus', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    const testTekst = `E2E Test ${Date.now()}`;
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!editModeActive) throw new Error('Redigeringsmodus ikke aktiv');
      const iframe = getEditorIframe(page); let clicked = false;
      for (const tag of ['h1','h2']) { const h = iframe.locator(tag).first(); if (await h.isVisible().catch(() => false)) { await h.click(); await page.waitForTimeout(1500); clicked = true; break; } }
      if (!clicked) throw new Error('Ingen overskrift funnet');
      await page.keyboard.press('Control+A'); await page.keyboard.type(testTekst);
      await iframe.locator('body').click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(2000); await collectToasts(page, logs);
      await safeScreenshot(page, 'test-results/steg9b-tekst-endret.png'); result.screenshots.push('steg9b-tekst-endret.png');
      result.steg.push({ navn: 'Steg 9b: Endre overskrift', status: 'OK', melding: `Tekst: "${testTekst}"`, tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg9b-feil.png'); result.screenshots.push('steg9b-feil.png');
      result.steg.push({ navn: 'Steg 9b: Endre overskrift', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const saved = await saveEditorChanges(page); await collectToasts(page, logs);
      await safeScreenshot(page, 'test-results/steg9c-lagret.png'); result.screenshots.push('steg9c-lagret.png');
      result.steg.push({ navn: 'Steg 9c: Lagre tekstendring', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) { result.steg.push({ navn: 'Steg 9c: Lagre tekstendring', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart }); }

    // ========================================
    // STEG 10: Bilde - Last opp
    // ========================================
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await page.locator(SEL.editorIframe).isVisible().catch(() => false))) {
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        editModeActive = await enterEditMode(page); if (!editModeActive) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (upload)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg10a-feil.png'); result.screenshots.push('steg10a-feil.png');
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (upload)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await openImageModal(page, 0))) throw new Error('Bilde-modal åpnet ikke');
      await safeScreenshot(page, 'test-results/steg10b-modal.png'); result.screenshots.push('steg10b-modal.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg10b-feil.png'); result.screenshots.push('steg10b-feil.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.locator(SEL.tabUpload).click(); await page.waitForTimeout(500);
      await page.locator('input[type="file"]').first().setInputFiles(createTestImage());
      await page.waitForTimeout(3000); await collectToasts(page, logs);
      await safeScreenshot(page, 'test-results/steg10c-opplastet.png'); result.screenshots.push('steg10c-opplastet.png');
      result.steg.push({ navn: 'Steg 10c: Last opp bilde', status: 'OK', melding: 'Testbilde lastet opp', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg10c-feil.png'); result.screenshots.push('steg10c-feil.png');
      result.steg.push({ navn: 'Steg 10c: Last opp bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click(); await page.waitForTimeout(3000); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 10d: Bruk bildet', status: 'OK', melding: 'Bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg10d-feil.png'); result.screenshots.push('steg10d-feil.png');
      result.steg.push({ navn: 'Steg 10d: Bruk bildet', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const saved = await saveEditorChanges(page); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 10e: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) { result.steg.push({ navn: 'Steg 10e: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart }); }

    // ========================================
    // STEG 11: Bilde - URL (Unsplash)
    // ========================================
    try { if (isPageAlive(page)) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500).catch(() => {}); } } catch {}

    const testBildeUrl = 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop';

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await page.locator(SEL.editorIframe).isVisible().catch(() => false))) {
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        if (!(await enterEditMode(page))) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (URL)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg11a-feil.png'); result.screenshots.push('steg11a-feil.png');
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (URL)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await openImageModal(page, 1))) throw new Error('Modal åpnet ikke');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg11b-feil.png'); result.screenshots.push('steg11b-feil.png');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.locator(SEL.tabUrl).click(); await page.waitForTimeout(1000);
      const urlInput = page.locator(`${SEL.imageDialog} input[type="url"], ${SEL.imageDialog} input[placeholder*="URL"], ${SEL.imageDialog} input[placeholder*="http"]`).first();
      let filled = await urlInput.isVisible().catch(() => false);
      if (filled) { await urlInput.fill(testBildeUrl); }
      else { for (const inp of await page.locator(`${SEL.imageDialog} input`).all()) { if ((await inp.isVisible().catch(() => false)) && (await inp.getAttribute('type').catch(() => '')) !== 'file') { await inp.fill(testBildeUrl); filled = true; break; } } }
      if (!filled) throw new Error('URL-input ikke funnet');
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'OK', melding: 'Unsplash-URL limt inn', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg11c-feil.png'); result.screenshots.push('steg11c-feil.png');
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click(); await page.waitForTimeout(3000); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'OK', melding: 'Lagret', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg11d-feil.png'); result.screenshots.push('steg11d-feil.png');
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const saved = await saveEditorChanges(page); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 11e: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) { result.steg.push({ navn: 'Steg 11e: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart }); }

    // ========================================
    // STEG 12: Bilde - AI
    // ========================================
    try { if (isPageAlive(page)) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500).catch(() => {}); } } catch {}

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await page.locator(SEL.editorIframe).isVisible().catch(() => false))) {
        await expect(page.locator(SEL.previewIframe)).toBeVisible({ timeout: 10000 }).catch(() => {});
        if (!(await enterEditMode(page))) throw new Error('Kunne ikke aktivere redigeringsmodus');
      }
      await page.waitForTimeout(3000);
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (AI)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12a-feil.png'); result.screenshots.push('steg12a-feil.png');
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (AI)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      if (!(await openImageModal(page, 2))) throw new Error('Modal åpnet ikke');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12b-feil.png'); result.screenshots.push('steg12b-feil.png');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await page.locator(SEL.tabAi).click(); await page.waitForTimeout(2000);
      const promptInput = page.locator(SEL.aiPromptInput);
      let elapsed = 0; let ready = false;
      while (!ready && elapsed < 30000) {
        if (!isPageAlive(page)) break;
        const v = await promptInput.inputValue().catch(() => ''); if (v.length > 10) { ready = true; console.log(`   ✅ AI-beskrivelse: "${v.substring(0,60)}..."`); break; } await page.waitForTimeout(2000); elapsed += 2000;
      }
      await safeScreenshot(page, 'test-results/steg12c-ai-beskrivelse.png'); result.screenshots.push('steg12c-ai-beskrivelse.png');
      result.steg.push({ navn: 'Steg 12c: Vent på AI-beskrivelse', status: ready ? 'OK' : 'FEILET', melding: ready ? `Mottatt etter ${Math.round(elapsed/1000)}s` : 'Timeout', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12c-feil.png'); result.screenshots.push('steg12c-feil.png');
      result.steg.push({ navn: 'Steg 12c: Vent på AI-beskrivelse', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const before = await page.locator(SEL.aiPromptInput).inputValue().catch(() => '');
      await expect(page.locator(SEL.enhancePromptBtn)).toBeVisible({ timeout: 5000 }); await page.locator(SEL.enhancePromptBtn).click();
      console.log('   ⏳ Venter på forbedret prompt...');
      let elapsed = 0; let done = false;
      while (!done && elapsed < 15000) {
        if (!isPageAlive(page)) break;
        await page.waitForTimeout(2000); elapsed += 2000; const a = await page.locator(SEL.aiPromptInput).inputValue().catch(() => ''); if (a !== before && a.length > 10) { done = true; console.log(`   ✅ Forbedret: "${a.substring(0,60)}..."`); }
      }
      await safeScreenshot(page, 'test-results/steg12d-forbedret.png'); result.screenshots.push('steg12d-forbedret.png');
      result.steg.push({ navn: 'Steg 12d: Forbedre prompt', status: done ? 'OK' : 'FEILET', melding: done ? `Forbedret etter ${Math.round(elapsed/1000)}s` : 'Timeout', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12d-feil.png'); result.screenshots.push('steg12d-feil.png');
      result.steg.push({ navn: 'Steg 12d: Forbedre prompt', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const imgBefore = await page.locator(`${SEL.imageDialog} img`).first().getAttribute('src').catch(() => '');
      await expect(page.locator(SEL.generateAiBtn)).toBeVisible({ timeout: 5000 }); await page.locator(SEL.generateAiBtn).click();
      console.log('   ⏳ Venter på AI-bildegenerering (maks 60s)...');
      let elapsed = 0; let done = false;
      // Redusert fra 90s til 60s for å unngå timeout
      while (!done && elapsed < 60000) {
        if (!isPageAlive(page)) break;
        await page.waitForTimeout(3000); elapsed += 3000; await collectToasts(page, logs);
        const a = await page.locator(`${SEL.imageDialog} img`).first().getAttribute('src').catch(() => '');
        if (a && a !== imgBefore && a.length > 20) { done = true; console.log(`   ✅ AI-bilde generert etter ${Math.round(elapsed/1000)}s`); }
      }
      await safeScreenshot(page, 'test-results/steg12e-ai-bilde.png'); result.screenshots.push('steg12e-ai-bilde.png');
      result.steg.push({ navn: 'Steg 12e: Generer med AI', status: done ? 'OK' : 'FEILET', melding: done ? `Generert etter ${Math.round(elapsed/1000)}s` : 'Timeout etter 60s', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12e-feil.png'); result.screenshots.push('steg12e-feil.png');
      result.steg.push({ navn: 'Steg 12e: Generer med AI', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.useImageBtn)).toBeVisible({ timeout: 10000 });
      await page.locator(SEL.useImageBtn).click(); await page.waitForTimeout(3000); await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'OK', melding: 'AI-bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg12f-feil.png'); result.screenshots.push('steg12f-feil.png');
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const saved = await saveEditorChanges(page); await collectToasts(page, logs);
      await safeScreenshot(page, 'test-results/steg12g-lagret.png'); result.screenshots.push('steg12g-lagret.png');
      result.steg.push({ navn: 'Steg 12g: Lagre editor', status: saved ? 'OK' : 'FEILET', melding: saved ? 'AI-bilde lagret' : 'Knapp ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) { result.steg.push({ navn: 'Steg 12g: Lagre editor', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart }); }

    // ================================================================
    // BETALINGSTEST (steg 13) — crash-proof
    // ================================================================

    // Lukk eventuelle åpne dialoger - ALT i try/catch
    try {
      if (isPageAlive(page)) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000).catch(() => {});
      }
    } catch {}

    // Sørg for at vi er ute av redigeringsmodus - ALT i try/catch
    try {
      if (isPageAlive(page)) {
        const stillEditing = await page.locator(SEL.editorIframe).isVisible().catch(() => false);
        if (stillEditing) {
          await saveEditorChanges(page).catch(() => {});
          await page.waitForTimeout(2000).catch(() => {});
        }
      }
    } catch {}

    // 13a: Klikk Publiser-knappen i ActionBar
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      await expect(page.locator(SEL.publishButton)).toBeVisible({ timeout: 15000 });
      await page.locator(SEL.publishButton).click();
      await page.waitForTimeout(2000);
      await collectToasts(page, logs);

      await safeScreenshot(page, 'test-results/steg13a-publiser-klikket.png');
      result.screenshots.push('steg13a-publiser-klikket.png');
      result.steg.push({ navn: 'Steg 13a: Klikk Publiser', status: 'OK', melding: 'Publiser-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg13a-feil.png');
      result.screenshots.push('steg13a-feil.png');
      result.steg.push({ navn: 'Steg 13a: Klikk Publiser', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 13b: Verifiser at pristabellen vises
    stegStart = Date.now();
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const pricingDialog = page.locator('[role="dialog"]').filter({ hasText: 'Velg plan' });
      await expect(pricingDialog).toBeVisible({ timeout: 10000 });

      const velgProBtn = pricingDialog.locator('button').filter({ hasText: 'Velg Pro' });
      await expect(velgProBtn).toBeVisible({ timeout: 5000 });

      await safeScreenshot(page, 'test-results/steg13b-pristabellen.png');
      result.screenshots.push('steg13b-pristabellen.png');
      result.steg.push({ navn: 'Steg 13b: Pristabellen vises', status: 'OK', melding: 'Dialog med Gratis/Pro/Premium synlig', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg13b-feil.png');
      result.screenshots.push('steg13b-feil.png');
      result.steg.push({ navn: 'Steg 13b: Pristabellen vises', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 13c: Klikk "Velg Pro" og verifiser at Stripe checkout åpnes
    stegStart = Date.now();
    let stripePage: Page | null = null;
    try {
      if (!isPageAlive(page)) throw new Error('Page lukket');
      const pricingDialog = page.locator('[role="dialog"]').filter({ hasText: 'Velg plan' });
      const velgProBtn = pricingDialog.locator('button').filter({ hasText: 'Velg Pro' });
      await expect(velgProBtn).toBeVisible({ timeout: 5000 });

      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 30000 }),
        velgProBtn.click(),
      ]);
      stripePage = newPage;

      await stripePage.waitForLoadState('domcontentloaded', { timeout: 30000 });
      const stripeUrl = stripePage.url();
      console.log(`   🔗 Stripe URL: ${stripeUrl}`);

      await safeScreenshot(page, 'test-results/steg13c-etter-klikk.png');
      result.screenshots.push('steg13c-etter-klikk.png');

      const isStripe = stripeUrl.includes('checkout.stripe.com');
      if (!isStripe) {
        throw new Error(`Forventet checkout.stripe.com, fikk: ${stripeUrl}`);
      }

      result.steg.push({ navn: 'Steg 13c: Velg Pro → Stripe', status: 'OK', melding: `Stripe checkout åpnet: ${stripeUrl.substring(0, 60)}...`, tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await safeScreenshot(page, 'test-results/steg13c-feil.png');
      result.screenshots.push('steg13c-feil.png');
      result.steg.push({ navn: 'Steg 13c: Velg Pro → Stripe', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 13d: Verifiser Stripe checkout-innhold
    stegStart = Date.now();
    try {
      if (!stripePage || stripePage.isClosed()) throw new Error('Stripe-fane ikke tilgjengelig');

      await stripePage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const pageContent = await stripePage.content().catch(() => '');
      const hasSubscribeBtn = pageContent.includes('Abonner') || pageContent.includes('Subscribe');
      const hasProText = pageContent.includes('Pro') || pageContent.includes('pro');
      const hasNettside = pageContent.includes('Nettside') || pageContent.includes('nettside');

      await stripePage.screenshot({ path: 'test-results/steg13d-stripe-checkout.png', fullPage: true }).catch(() => {});
      result.screenshots.push('steg13d-stripe-checkout.png');

      const details: string[] = [];
      if (hasSubscribeBtn) details.push('Abonner-knapp');
      if (hasProText) details.push('Pro-plan');
      if (hasNettside) details.push('Nettside.ai');

      const success = hasSubscribeBtn && hasProText;
      result.steg.push({
        navn: 'Steg 13d: Verifiser Stripe checkout',
        status: success ? 'OK' : 'FEILET',
        melding: success
          ? `Stripe checkout OK: ${details.join(', ')}`
          : `Mangler innhold: Abonner=${hasSubscribeBtn}, Pro=${hasProText}`,
        tidBrukt: Date.now() - stegStart
      });

      await stripePage.close().catch(() => {});
    } catch (error) {
      if (stripePage) await stripePage.screenshot({ path: 'test-results/steg13d-feil.png' }).catch(() => {});
      result.screenshots.push('steg13d-feil.png');
      result.steg.push({ navn: 'Steg 13d: Verifiser Stripe checkout', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
      if (stripePage) await stripePage.close().catch(() => {});
    }

    // ========================================
    // FERDIG - rapport genereres ALLTID
    // ========================================
    result.sluttTid = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
    printReport(result);
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/rapport.json', JSON.stringify(result, null, 2));

    const kritiskeFeil = result.steg.filter(s => s.status === 'FEILET' && (s.navn.includes('Steg 5') || s.navn.includes('Steg 8:')));
    if (kritiskeFeil.length > 0) throw new Error(`Kritiske steg feilet: ${kritiskeFeil.map(s => s.navn).join(', ')}`);
  });
});
