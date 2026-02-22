// ===================================================
// TEST: Ny bruker - registrering, generering og editor
// VERSION: 4.1 (komplett E2E inkl. editor-tester)
// ===================================================

import { test, expect, Page, BrowserContext } from '@playwright/test';
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
// Konstanter
// ===================================================

const IGNORED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'doubleclick.net',
];

// Supabase-endepunkter som gir forventede "tomme" eller "for tidlige" responser
const IGNORED_URL_PATTERNS = [
  '/rest/v1/project_history',   // Skrives etter generering, tom før det
  '/rest/v1/deployment_issues', // Tom liste = ingen problemer = forventet
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
      logs.push({
        timestamp: new Date().toISOString(),
        type: type as 'error' | 'warning',
        message: text,
        details: msg.location().url
      });
    }
  });

  page.on('pageerror', (error) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      message: `JS Error: ${error.message}`,
      details: error.stack
    });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !isIgnoredUrl(url)) {
      logs.push({
        timestamp: new Date().toISOString(),
        type: 'network',
        message: `HTTP ${status}: ${url}`,
        details: response.statusText()
      });
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (isIgnoredUrl(url)) return;
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'network',
      message: `Request failed: ${url}`,
      details: request.failure()?.errorText
    });
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
            logs.push({
              timestamp: new Date().toISOString(),
              type: 'toast',
              message: text.trim()
            });
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

async function enterEditMode(page: Page): Promise<boolean> {
  try {
    const redigerButton = page.locator('button:has-text("Rediger")').first();
    await expect(redigerButton).toBeVisible({ timeout: 10000 });
    await redigerButton.click();
    await page.waitForTimeout(2000);

    for (const indicator of ['text=redigeringsmodus', 'text=Lagre endringer', 'text=Klikk tekst', 'text=Klikk bilder']) {
      const visible = await page.locator(indicator).first().isVisible().catch(() => false);
      if (visible) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function saveEditorChanges(page: Page): Promise<boolean> {
  try {
    const lagreButton = page.locator('button:has-text("Lagre endringer")').first();
    const visible = await lagreButton.isVisible().catch(() => false);
    if (visible) {
      await lagreButton.click();
      await page.waitForTimeout(3000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function openImageModal(page: Page): Promise<boolean> {
  try {
    const allImages = await page.locator('img').all();
    for (const img of allImages) {
      const visible = await img.isVisible().catch(() => false);
      if (!visible) continue;
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth).catch(() => 0);
      if (naturalWidth <= 50) continue;
      await img.click();
      await page.waitForTimeout(2000);
      const modalOpen = await page.locator('text=Endre bilde').first().isVisible().catch(() => false);
      if (modalOpen) return true;
    }
    return false;
  } catch {
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

  if (result.kladdUrl) {
    console.log('\n🔗 KLADD-URL:');
    console.log(`   ${result.kladdUrl}`);
  }

  const errors = result.logs.filter(l => l.type === 'error');
  const networkErrors = result.logs.filter(l => l.type === 'network');
  const warnings = result.logs.filter(l => l.type === 'warning');
  const toasts = result.logs.filter(l => l.type === 'toast');

  if (errors.length > 0) {
    console.log(`\n❌ FEIL (${errors.length}):`);
    errors.forEach(e => console.log(`   - ${e.message}`));
  }
  if (networkErrors.length > 0) {
    console.log(`\n🌐 NETTVERKSFEIL (${networkErrors.length}):`);
    networkErrors.forEach(e => console.log(`   - ${e.message}`));
  }
  if (warnings.length > 0) {
    console.log(`\n⚠️ ADVARSLER (${warnings.length}):`);
    warnings.forEach(e => console.log(`   - ${e.message}`));
  }
  if (toasts.length > 0) {
    console.log(`\n💬 TOAST-MELDINGER (${toasts.length}):`);
    toasts.forEach(e => console.log(`   - ${e.message}`));
  }
  if (result.screenshots.length > 0) {
    console.log(`\n📸 SCREENSHOTS:`);
    result.screenshots.forEach(s => console.log(`   - ${s}`));
  }

  const feilet = result.steg.filter(s => s.status === 'FEILET').length;
  const ok = result.steg.filter(s => s.status === 'OK').length;

  console.log('\n' + '='.repeat(70));
  if (feilet === 0) {
    console.log(`🎉 RESULTAT: ALLE ${ok} STEG FULLFØRT`);
  } else {
    console.log(`💥 RESULTAT: ${feilet} STEG FEILET, ${ok} STEG OK`);
  }
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
      await page.goto('/', { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await expect(page.getByText('Firmanavn').first()).toBeVisible({ timeout: 10000 });
      await collectToasts(page, logs);

      result.steg.push({
        navn: 'Steg 1: Åpne app.nettside.ai',
        status: 'OK',
        melding: 'Siden lastet, skjema synlig',
        tidBrukt: Date.now() - stegStart
      });
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
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 2: Fyll ut skjema', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 3: Klikk Lagre
    // ========================================
    stegStart = Date.now();
    try {
      const lagreButton = page.getByRole('button', { name: /lagre/i });
      await expect(lagreButton).toBeVisible({ timeout: 5000 });
      await lagreButton.click();
      await collectToasts(page, logs);

      result.steg.push({ navn: 'Steg 3: Klikk Lagre', status: 'OK', melding: 'Lagre-knapp klikket', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg3-feil.png' }).catch(() => {});
      result.screenshots.push('steg3-feil.png');
      await collectToasts(page, logs);
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
        navn: 'Steg 4: Sjekk progress-animasjon',
        status: progressStartet ? 'OK' : 'FEILET',
        melding: progressStartet ? 'Progress-animasjon startet' : 'Progress-animasjon IKKE synlig',
        tidBrukt: Date.now() - stegStart
      });

      if (!progressStartet) {
        await page.screenshot({ path: 'test-results/steg4-ingen-progress.png' }).catch(() => {});
        result.screenshots.push('steg4-ingen-progress.png');
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg4-feil.png' }).catch(() => {});
      result.screenshots.push('steg4-feil.png');
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 4: Sjekk progress-animasjon', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 5: Vent på generering (~3 min)
    // ========================================
    stegStart = Date.now();
    let genereringFullfort = false;
    try {
      const toastInterval = setInterval(async () => {
        await collectToasts(page, logs).catch(() => {});
      }, 5000);

      const maxWait = 180000;
      const pollInterval = 3000;
      let elapsed = 0;

      while (!genereringFullfort && elapsed < maxWait) {
        const kladdVisible = await page.locator('button:has-text("Kladd")').first().isVisible().catch(() => false);
        if (kladdVisible) { genereringFullfort = true; break; }

        const previewVisible = await page.locator('iframe').first().isVisible().catch(() => false);
        if (previewVisible) {
          await page.waitForTimeout(3000);
          const kladdNow = await page.locator('button:has-text("Kladd")').first().isVisible().catch(() => false);
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
          ? `Generering fullført etter ${Math.round((Date.now() - stegStart) / 1000)}s`
          : `Timeout etter ${Math.round(maxWait / 1000)}s - Kladd-knapp ikke synlig`,
        tidBrukt: Date.now() - stegStart
      });

      const screenshotName = genereringFullfort ? 'steg5-generert.png' : 'steg5-timeout.png';
      await page.screenshot({ path: `test-results/${screenshotName}`, fullPage: true }).catch(() => {});
      result.screenshots.push(screenshotName);
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg5-feil.png', fullPage: true }).catch(() => {});
      result.screenshots.push('steg5-feil.png');
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 5: Vent på generering', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 6: Klikk Kladd-knappen
    // ========================================
    stegStart = Date.now();
    try {
      const kladdSelectors = ['button:has-text("Kladd")', 'button:has(span:text("Kladd"))', '[data-testid*="kladd"]'];
      let kladdButton = null;

      for (const selector of kladdSelectors) {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) { kladdButton = btn; break; }
      }

      if (kladdButton) {
        await kladdButton.click();
        await collectToasts(page, logs);
        result.steg.push({ navn: 'Steg 6: Klikk Kladd-knappen', status: 'OK', melding: 'Kladd-knapp klikket', tidBrukt: Date.now() - stegStart });
      } else {
        throw new Error('Kladd-knapp ikke funnet');
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg6-feil.png' }).catch(() => {});
      result.screenshots.push('steg6-feil.png');
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 6: Klikk Kladd-knappen', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 7: Hent kladd-URL
    // ========================================
    stegStart = Date.now();
    try {
      await page.waitForTimeout(5000);
      await collectToasts(page, logs);

      const urlPatterns = [
        /https:\/\/draft\.kundesider\.pages\.dev\/[a-zA-Z0-9-]+\/?/,
        /https:\/\/draft--vibe-kundesider\.netlify\.app\/[a-zA-Z0-9-]+\/?/,
      ];

      const pageContent = await page.content();
      for (const pattern of urlPatterns) {
        const urlMatch = pageContent.match(pattern);
        if (urlMatch) { result.kladdUrl = urlMatch[0]; break; }
      }

      if (!result.kladdUrl) {
        const links = await page.locator('a[href*="draft"]').all();
        for (const link of links) {
          const href = await link.getAttribute('href');
          if (href && (href.includes('draft.kundesider.pages.dev') || href.includes('draft--vibe-kundesider'))) {
            result.kladdUrl = href; break;
          }
        }
      }

      if (!result.kladdUrl) {
        const iframes = await page.locator('iframe').all();
        for (const iframe of iframes) {
          const src = await iframe.getAttribute('src');
          if (src && src.includes('draft.kundesider.pages.dev')) {
            result.kladdUrl = src; break;
          }
        }
      }

      if (!result.kladdUrl) {
        for (const log of logs) {
          if (log.type === 'toast' || log.type === 'network') {
            for (const pattern of urlPatterns) {
              const match = log.message.match(pattern);
              if (match) { result.kladdUrl = match[0]; break; }
            }
            if (result.kladdUrl) break;
          }
        }
      }

      if (result.kladdUrl) {
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'OK', melding: `URL: ${result.kladdUrl}`, tidBrukt: Date.now() - stegStart });
      } else {
        await page.screenshot({ path: 'test-results/steg7-ingen-url.png' }).catch(() => {});
        result.screenshots.push('steg7-ingen-url.png');
        result.steg.push({ navn: 'Steg 7: Hent kladd-URL', status: 'FEILET', melding: 'Kladd-URL ikke funnet', tidBrukt: Date.now() - stegStart });
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
    //  EDITOR-TESTER (steg 9-11)
    //  Bruker er nå innlogget med generert nettside
    //
    // ================================================================

    // ========================================
    // STEG 9: Tekstredigering
    // 9a) Klikk "Rediger"
    // 9b) Klikk overskrift, endre tekst
    // 9c) Klikk "Lagre endringer"
    // 9d) Verifiser at teksten ble lagret
    // ========================================

    // 9a: Gå inn i redigeringsmodus
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
        melding: editModeActive ? 'Redigeringsmodus aktivert' : 'Klarte ikke aktivere redigeringsmodus',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg9a-feil.png' }).catch(() => {});
      result.screenshots.push('steg9a-feil.png');
      result.steg.push({ navn: 'Steg 9a: Aktiver redigeringsmodus', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 9b: Klikk overskrift og endre tekst
    stegStart = Date.now();
    const testTekst = `E2E Test ${Date.now()}`;
    try {
      if (!editModeActive) throw new Error('Redigeringsmodus ikke aktiv');

      let headingClicked = false;
      for (const selector of ['h1', 'h2', '[contenteditable]']) {
        const heading = page.locator(selector).first();
        const visible = await heading.isVisible().catch(() => false);
        if (visible) {
          await heading.click();
          await page.waitForTimeout(1500);
          const editable = await page.locator('[contenteditable="true"]').first().isVisible().catch(() => false);
          if (editable) { headingClicked = true; break; }
        }
      }
      if (!headingClicked) throw new Error('Klarte ikke klikke på overskrift');

      await page.keyboard.press('Control+A');
      await page.keyboard.type(testTekst);
      await page.locator('body').click({ position: { x: 10, y: 10 } });
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
      result.steg.push({
        navn: 'Steg 9c: Lagre tekstendring',
        status: saved ? 'OK' : 'FEILET',
        melding: saved ? 'Endringer lagret' : '"Lagre endringer" ikke funnet',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      result.steg.push({ navn: 'Steg 9c: Lagre tekstendring', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 9d: Verifiser tekst
    stegStart = Date.now();
    try {
      await page.waitForTimeout(2000);
      const pageContent = await page.content();
      const tekstLagret = pageContent.includes(testTekst);
      result.steg.push({
        navn: 'Steg 9d: Verifiser tekst lagret',
        status: tekstLagret ? 'OK' : 'FEILET',
        melding: tekstLagret ? 'Teksten er synlig' : 'Teksten ble ikke funnet etter lagring',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      result.steg.push({ navn: 'Steg 9d: Verifiser tekst lagret', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 10: Bilde - Last opp (B1)
    // 10a) Klikk "Rediger"
    // 10b) Klikk bilde → "Endre bilde"-modal
    // 10c) Last opp testbilde
    // 10d) Klikk "Bruk dette bildet"
    // 10e) Klikk "Lagre endringer"
    // ========================================

    // 10a: Redigeringsmodus
    stegStart = Date.now();
    try {
      editModeActive = await enterEditMode(page);
      if (!editModeActive) throw new Error('Kunne ikke aktivere redigeringsmodus');
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (bilde-upload)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10a-feil.png' }).catch(() => {});
      result.screenshots.push('steg10a-feil.png');
      result.steg.push({ navn: 'Steg 10a: Redigeringsmodus (bilde-upload)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10b: Åpne bilde-modal
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('"Endre bilde"-modal åpnet ikke');
      await page.screenshot({ path: 'test-results/steg10b-modal.png' }).catch(() => {});
      result.screenshots.push('steg10b-modal.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10b-feil.png' }).catch(() => {});
      result.screenshots.push('steg10b-feil.png');
      result.steg.push({ navn: 'Steg 10b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10c: Last opp testbilde
    stegStart = Date.now();
    try {
      await page.locator('text=Last opp').first().click().catch(() => {});
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
      const brukButton = page.locator('button:has-text("Bruk dette bildet")').first();
      await expect(brukButton).toBeVisible({ timeout: 10000 });
      await brukButton.click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 10d: Bruk opplastet bilde', status: 'OK', melding: 'Bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg10d-feil.png' }).catch(() => {});
      result.screenshots.push('steg10d-feil.png');
      result.steg.push({ navn: 'Steg 10d: Bruk opplastet bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 10e: Lagre endringer
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg10e-lagret.png' }).catch(() => {});
      result.screenshots.push('steg10e-lagret.png');
      result.steg.push({ navn: 'Steg 10e: Lagre bilde-upload', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : '"Lagre endringer" ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 10e: Lagre bilde-upload', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 11: Bilde - URL (B2)
    // 11a) Klikk "Rediger"
    // 11b) Klikk bilde → modal
    // 11c) Klikk "URL"-fane → lim inn Unsplash-URL
    // 11d) Klikk "Bruk dette bildet"
    // 11e) Klikk "Lagre endringer"
    // ========================================

    const testBildeUrl = 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop';

    // 11a: Redigeringsmodus
    stegStart = Date.now();
    try {
      editModeActive = await enterEditMode(page);
      if (!editModeActive) throw new Error('Kunne ikke aktivere redigeringsmodus');
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (bilde-URL)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11a-feil.png' }).catch(() => {});
      result.screenshots.push('steg11a-feil.png');
      result.steg.push({ navn: 'Steg 11a: Redigeringsmodus (bilde-URL)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11b: Åpne bilde-modal
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('"Endre bilde"-modal åpnet ikke');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11b-feil.png' }).catch(() => {});
      result.screenshots.push('steg11b-feil.png');
      result.steg.push({ navn: 'Steg 11b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11c: URL-fane og lim inn URL
    stegStart = Date.now();
    try {
      await page.locator('text=URL').first().click();
      await page.waitForTimeout(1000);

      let urlFilled = false;
      for (const selector of ['input[type="url"]', 'input[placeholder*="URL"]', 'input[placeholder*="url"]', 'input[placeholder*="http"]', 'input[placeholder*="Lim inn"]']) {
        const input = page.locator(selector).first();
        const visible = await input.isVisible().catch(() => false);
        if (visible) { await input.fill(testBildeUrl); urlFilled = true; break; }
      }

      if (!urlFilled) {
        const modalInputs = await page.locator('[role="dialog"] input, [class*="modal"] input').all();
        for (const input of modalInputs) {
          const visible = await input.isVisible().catch(() => false);
          const type = await input.getAttribute('type').catch(() => '');
          if (visible && type !== 'file') { await input.fill(testBildeUrl); urlFilled = true; break; }
        }
      }

      if (!urlFilled) throw new Error('URL-inputfelt ikke funnet');
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'test-results/steg11c-url.png' }).catch(() => {});
      result.screenshots.push('steg11c-url.png');
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'OK', melding: 'Unsplash-URL limt inn', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11c-feil.png' }).catch(() => {});
      result.screenshots.push('steg11c-feil.png');
      result.steg.push({ navn: 'Steg 11c: Lim inn bilde-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11d: Bruk dette bildet
    stegStart = Date.now();
    try {
      const brukButton = page.locator('button:has-text("Bruk dette bildet")').first();
      await expect(brukButton).toBeVisible({ timeout: 10000 });
      await brukButton.click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'OK', melding: 'Bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg11d-feil.png' }).catch(() => {});
      result.screenshots.push('steg11d-feil.png');
      result.steg.push({ navn: 'Steg 11d: Bruk URL-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 11e: Lagre endringer
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg11e-lagret.png' }).catch(() => {});
      result.screenshots.push('steg11e-lagret.png');
      result.steg.push({ navn: 'Steg 11e: Lagre bilde-URL', status: saved ? 'OK' : 'FEILET', melding: saved ? 'Lagret' : '"Lagre endringer" ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 11e: Lagre bilde-URL', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // STEG 12: Bilde - AI (B3)
    // 12a) Klikk "Rediger"
    // 12b) Klikk bilde → modal
    // 12c) Klikk "AI"-fane → vent på beskrivelse
    // 12d) Klikk "Forbedre prompt" → vent
    // 12e) Klikk "Generer med AI" → vent 30-60s
    // 12f) Klikk "Bruk dette bildet"
    // 12g) Klikk "Lagre endringer"
    // ========================================

    // 12a: Redigeringsmodus
    stegStart = Date.now();
    try {
      editModeActive = await enterEditMode(page);
      if (!editModeActive) throw new Error('Kunne ikke aktivere redigeringsmodus');
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (bilde-AI)', status: 'OK', melding: 'Aktivert', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12a-feil.png' }).catch(() => {});
      result.screenshots.push('steg12a-feil.png');
      result.steg.push({ navn: 'Steg 12a: Redigeringsmodus (bilde-AI)', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12b: Åpne bilde-modal
    stegStart = Date.now();
    try {
      const modalOpened = await openImageModal(page);
      if (!modalOpened) throw new Error('"Endre bilde"-modal åpnet ikke');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'OK', melding: 'Modal åpnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12b-feil.png' }).catch(() => {});
      result.screenshots.push('steg12b-feil.png');
      result.steg.push({ navn: 'Steg 12b: Åpne bilde-modal', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12c: AI-fane → vent på auto-generert beskrivelse
    stegStart = Date.now();
    try {
      await page.locator('text=AI').first().click();
      await page.waitForTimeout(2000);

      const promptTextarea = page.locator('textarea').first();
      const maxWait = 30000;
      const poll = 2000;
      let elapsed = 0;
      let ready = false;

      while (!ready && elapsed < maxWait) {
        const value = await promptTextarea.inputValue().catch(() => '');
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
        melding: ready ? `Mottatt etter ${Math.round(elapsed / 1000)}s` : `Timeout etter ${Math.round(maxWait / 1000)}s`,
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
      const promptBefore = await page.locator('textarea').first().inputValue().catch(() => '');
      await page.locator('text=Forbedre prompt').first().click();
      console.log('   ⏳ Venter på forbedret prompt...');

      const maxWait = 15000;
      const poll = 2000;
      let elapsed = 0;
      let done = false;

      while (!done && elapsed < maxWait) {
        await page.waitForTimeout(poll);
        elapsed += poll;
        const after = await page.locator('textarea').first().inputValue().catch(() => '');
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
        melding: done ? `Forbedret etter ${Math.round(elapsed / 1000)}s` : `Timeout etter ${Math.round(maxWait / 1000)}s`,
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
      const imgBefore = await page.locator('[role="dialog"] img, [class*="modal"] img').first()
        .getAttribute('src').catch(() => '');

      await page.locator('button:has-text("Generer med AI")').first().click();
      console.log('   ⏳ Venter på AI-bildegenerering (30-90s)...');

      const maxWait = 90000;
      const poll = 3000;
      let elapsed = 0;
      let done = false;

      while (!done && elapsed < maxWait) {
        await page.waitForTimeout(poll);
        elapsed += poll;
        await collectToasts(page, logs);

        const imgAfter = await page.locator('[role="dialog"] img, [class*="modal"] img').first()
          .getAttribute('src').catch(() => '');
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

    // 12f: Bruk dette bildet
    stegStart = Date.now();
    try {
      const brukButton = page.locator('button:has-text("Bruk dette bildet")').first();
      await expect(brukButton).toBeVisible({ timeout: 10000 });
      await brukButton.click();
      await page.waitForTimeout(3000);
      await collectToasts(page, logs);
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'OK', melding: 'AI-bilde valgt', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg12f-feil.png' }).catch(() => {});
      result.screenshots.push('steg12f-feil.png');
      result.steg.push({ navn: 'Steg 12f: Bruk AI-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // 12g: Lagre endringer
    stegStart = Date.now();
    try {
      const saved = await saveEditorChanges(page);
      await collectToasts(page, logs);
      await page.screenshot({ path: 'test-results/steg12g-lagret.png' }).catch(() => {});
      result.screenshots.push('steg12g-lagret.png');
      result.steg.push({ navn: 'Steg 12g: Lagre AI-bilde', status: saved ? 'OK' : 'FEILET', melding: saved ? 'AI-bilde lagret' : '"Lagre endringer" ikke funnet', tidBrukt: Date.now() - stegStart });
    } catch (error) {
      result.steg.push({ navn: 'Steg 12g: Lagre AI-bilde', status: 'FEILET', melding: `${error}`, tidBrukt: Date.now() - stegStart });
    }

    // ========================================
    // FERDIG - Skriv rapport
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
