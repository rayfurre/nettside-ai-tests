// ===================================================
// TEST: Ny bruker registrering og nettside-generering
// VERSION: 2.0 (kjører alltid ferdig, rapporterer alt)
// ===================================================

import { test, expect, Page } from '@playwright/test';
import { getDagensBedrift, genererUnikEpost } from './testdata';

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

async function setupMonitoring(page: Page, logs: LogEntry[]): Promise<void> {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      logs.push({
        timestamp: new Date().toISOString(),
        type: type as 'error' | 'warning',
        message: msg.text(),
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
    if (status >= 400) {
      logs.push({
        timestamp: new Date().toISOString(),
        type: 'network',
        message: `HTTP ${status}: ${response.url()}`,
        details: response.statusText()
      });
    }
  });
  
  page.on('requestfailed', (request) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'network',
      message: `Request failed: ${request.url()}`,
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

test.describe('Nettside.ai - Komplett test', () => {
  
  test('Registrering, generering og kladd-verifisering', async ({ page, context }) => {
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
      
      result.steg.push({
        navn: 'Steg 1: Åpne app.nettside.ai',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
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
      
      result.steg.push({
        navn: 'Steg 2: Fyll ut skjema',
        status: 'OK',
        melding: 'Alle 6 felter utfylt',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg2-feil.png' }).catch(() => {});
      result.screenshots.push('steg2-feil.png');
      await collectToasts(page, logs);
      
      result.steg.push({
        navn: 'Steg 2: Fyll ut skjema',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
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
      
      result.steg.push({
        navn: 'Steg 3: Klikk Lagre',
        status: 'OK',
        melding: 'Lagre-knapp klikket',
        tidBrukt: Date.now() - stegStart
      });
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg3-feil.png' }).catch(() => {});
      result.screenshots.push('steg3-feil.png');
      await collectToasts(page, logs);
      
      result.steg.push({
        navn: 'Steg 3: Klikk Lagre',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
    }

    // ========================================
    // STEG 4: Sjekk progress-animasjon
    // ========================================
    stegStart = Date.now();
    let progressStartet = false;
    try {
      await page.waitForTimeout(2000);
      
      const progressSelectors = [
        '[role="progressbar"]',
        '.progress',
        '[data-state="loading"]',
        '.animate-pulse',
        '.animate-spin',
        '[class*="progress"]',
        '[class*="loading"]'
      ];
      
      for (const selector of progressSelectors) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        if (isVisible) {
          progressStartet = true;
          break;
        }
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
      
      result.steg.push({
        navn: 'Steg 4: Sjekk progress-animasjon',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
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
      
      // Vent på at Kladd-knappen blir synlig (indikerer ferdig generering)
      const maxWait = 180000; // 3 min
      const pollInterval = 3000;
      let elapsed = 0;
      
      while (!genereringFullfort && elapsed < maxWait) {
        // Sjekk om Kladd-knappen er synlig
        const kladdVisible = await page.locator('button:has-text("Kladd")').first().isVisible().catch(() => false);
        if (kladdVisible) {
          genereringFullfort = true;
          break;
        }
        
        // Alternativt: sjekk om forhåndsvisning er synlig
        const previewVisible = await page.locator('iframe').first().isVisible().catch(() => false);
        if (previewVisible) {
          // Gi litt ekstra tid for at knapper skal lastes
          await page.waitForTimeout(3000);
          const kladdNow = await page.locator('button:has-text("Kladd")').first().isVisible().catch(() => false);
          if (kladdNow) {
            genereringFullfort = true;
            break;
          }
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
      
      // Ta screenshot uansett
      const screenshotName = genereringFullfort ? 'steg5-generert.png' : 'steg5-timeout.png';
      await page.screenshot({ path: `test-results/${screenshotName}`, fullPage: true }).catch(() => {});
      result.screenshots.push(screenshotName);
      
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg5-feil.png', fullPage: true }).catch(() => {});
      result.screenshots.push('steg5-feil.png');
      await collectToasts(page, logs);
      
      result.steg.push({
        navn: 'Steg 5: Vent på generering',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
    }

    // ========================================
    // STEG 6: Klikk Kladd-knappen
    // ========================================
    stegStart = Date.now();
    let kladdKlikket = false;
    try {
      // Prøv flere selektorer for Kladd-knappen
      const kladdSelectors = [
        'button:has-text("Kladd")',
        'button:has(span:text("Kladd"))',
        '[data-testid*="kladd"]',
        'button >> text=Kladd'
      ];
      
      let kladdButton = null;
      for (const selector of kladdSelectors) {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          kladdButton = btn;
          break;
        }
      }
      
      if (kladdButton) {
        await kladdButton.click();
        kladdKlikket = true;
        await collectToasts(page, logs);
        
        result.steg.push({
          navn: 'Steg 6: Klikk Kladd-knappen',
          status: 'OK',
          melding: 'Kladd-knapp klikket',
          tidBrukt: Date.now() - stegStart
        });
      } else {
        throw new Error('Kladd-knapp ikke funnet med noen av selektorene');
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg6-feil.png' }).catch(() => {});
      result.screenshots.push('steg6-feil.png');
      await collectToasts(page, logs);
      
      result.steg.push({
        navn: 'Steg 6: Klikk Kladd-knappen',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
    }

    // ========================================
    // STEG 7: Hent kladd-URL fra varsel
    // ========================================
    stegStart = Date.now();
    try {
      // Vent på at varsel vises
      await page.waitForTimeout(5000);
      await collectToasts(page, logs);
      
      // Finn URL i siden
      const urlPattern = /https:\/\/draft--vibe-kundesider\.netlify\.app\/[a-zA-Z0-9-]+\/?/;
      const pageContent = await page.content();
      const urlMatch = pageContent.match(urlPattern);
      
      if (urlMatch) {
        result.kladdUrl = urlMatch[0];
        result.steg.push({
          navn: 'Steg 7: Hent kladd-URL',
          status: 'OK',
          melding: `URL funnet: ${result.kladdUrl}`,
          tidBrukt: Date.now() - stegStart
        });
      } else {
        // Prøv å finne lenke
        const links = await page.locator('a[href*="netlify"]').all();
        for (const link of links) {
          const href = await link.getAttribute('href');
          if (href && href.includes('draft--vibe-kundesider')) {
            result.kladdUrl = href;
            break;
          }
        }
        
        if (result.kladdUrl) {
          result.steg.push({
            navn: 'Steg 7: Hent kladd-URL',
            status: 'OK',
            melding: `URL funnet via lenke: ${result.kladdUrl}`,
            tidBrukt: Date.now() - stegStart
          });
        } else {
          await page.screenshot({ path: 'test-results/steg7-ingen-url.png' }).catch(() => {});
          result.screenshots.push('steg7-ingen-url.png');
          
          result.steg.push({
            navn: 'Steg 7: Hent kladd-URL',
            status: 'FEILET',
            melding: 'Kunne ikke finne kladd-URL i varselet',
            tidBrukt: Date.now() - stegStart
          });
        }
      }
    } catch (error) {
      await page.screenshot({ path: 'test-results/steg7-feil.png' }).catch(() => {});
      result.screenshots.push('steg7-feil.png');
      await collectToasts(page, logs);
      
      result.steg.push({
        navn: 'Steg 7: Hent kladd-URL',
        status: 'FEILET',
        melding: `${error}`,
        tidBrukt: Date.now() - stegStart
      });
    }

    // ========================================
    // STEG 8: Verifiser at kladd-URL fungerer
    // ========================================
    stegStart = Date.now();
    if (result.kladdUrl) {
      try {
        const newPage = await context.newPage();
        const response = await newPage.goto(result.kladdUrl, { timeout: 30000 });
        
        const status = response?.status() || 0;
        const bodyContent = await newPage.locator('body').innerHTML().catch(() => '');
        
        await newPage.screenshot({ path: 'test-results/steg8-kladd-side.png', fullPage: true }).catch(() => {});
        result.screenshots.push('steg8-kladd-side.png');
        
        if (status === 200 && bodyContent.length > 500) {
          result.steg.push({
            navn: 'Steg 8: Verifiser kladd-URL',
            status: 'OK',
            melding: `HTTP ${status}, innhold: ${bodyContent.length} tegn`,
            tidBrukt: Date.now() - stegStart
          });
        } else {
          result.steg.push({
            navn: 'Steg 8: Verifiser kladd-URL',
            status: 'FEILET',
            melding: `HTTP ${status}, innhold: ${bodyContent.length} tegn (forventet >500)`,
            tidBrukt: Date.now() - stegStart
          });
        }
        
        await newPage.close();
      } catch (error) {
        result.steg.push({
          navn: 'Steg 8: Verifiser kladd-URL',
          status: 'FEILET',
          melding: `${error}`,
          tidBrukt: Date.now() - stegStart
        });
      }
    } else {
      result.steg.push({
        navn: 'Steg 8: Verifiser kladd-URL',
        status: 'HOPPET OVER',
        melding: 'Ingen kladd-URL å verifisere',
        tidBrukt: 0
      });
    }

    // ========================================
    // FERDIG - Skriv rapport
    // ========================================
    result.sluttTid = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
    printReport(result);
    
    // Lagre rapport som JSON
    const fs = await import('fs');
    fs.writeFileSync('test-results/rapport.json', JSON.stringify(result, null, 2));
    
    // Fail testen hvis kritiske steg feilet
    const kritiskeFeil = result.steg.filter(s => 
      s.status === 'FEILET' && 
      (s.navn.includes('Steg 5') || s.navn.includes('Steg 8'))
    );
    
    if (kritiskeFeil.length > 0) {
      throw new Error(`Kritiske steg feilet: ${kritiskeFeil.map(s => s.navn).join(', ')}`);
    }
  });
});
