# Nettside.ai E2E-tester

Automatiserte tester for [app.nettside.ai](https://app.nettside.ai) ved hjelp av Playwright.

## Hva testes?

**Daglig test kl 08:00:**
- Ny bruker registrering
- Utfylling av skjema (firmanavn, forretningsidé, kontaktinfo)
- Nettside-generering via n8n + Gemini AI
- Verifisering av at forhåndsvisning vises

## Testdata

Testen roterer gjennom 10 norske testbedrifter:

| Dag | Bedrift |
|-----|---------|
| 1 | Hansens Rørlegger AS |
| 2 | Klipp & Kruller Frisør |
| 3 | Pizzeria Napoli |
| 4 | Ren & Skinn Renhold |
| 5 | Bjørnsen Elektro |
| 6 | Solsikken Blomster |
| 7 | Kaffebrenneriet Mølla |
| 8 | Aktiv Fysioterapi |
| 9 | Bildoktoren AS |
| 10 | Advokat Lund & Co |

## Oppsett

### 1. Opprett GitHub repo

```bash
git clone https://github.com/DITT-BRUKERNAVN/nettside-ai-tests.git
cd nettside-ai-tests
```

### 2. Legg til Emailit API-nøkkel

1. Gå til **Settings** → **Secrets and variables** → **Actions**
2. Klikk **New repository secret**
3. Name: `EMAILIT_API_KEY`
4. Secret: Din API-nøkkel fra Emailit (starter med `em_...`)
5. Klikk **Add secret**

### 3. Verifiser avsender-domene i Emailit

Domenet `emailit.nettside.ai` må være verifisert i Emailit med SPF, DKIM og DMARC.

## Kjør manuelt

### Via GitHub
1. Gå til **Actions**
2. Velg **Daglig E2E Test - Nettside.ai**
3. Klikk **Run workflow**

### Lokalt (krever Node.js)
```bash
npm install
npx playwright install chromium
npm test
```

## E-postvarsling

Ved hver kjøring sendes e-post til `kundesenter@nettside.ai`:

**Ved suksess:**
```
✅ BESTÅTT - Nettside.ai daglig test (21.02.2025 kl 08:00)
```

**Ved feil:**
```
❌ FEILET - Nettside.ai daglig test (21.02.2025 kl 08:00)
```

E-posten inneholder lenke til full rapport med screenshots.

## Filstruktur

```
nettside-ai-tests/
├── .github/
│   └── workflows/
│       └── daily-test.yml    # GitHub Actions workflow
├── tests/
│   ├── testdata.ts           # 10 norske testbedrifter
│   └── ny-bruker.spec.ts     # Hovedtest
├── playwright.config.ts       # Playwright-konfigurasjon
├── package.json
└── README.md
```

## Feilsøking

### Test feiler konsekvent
1. Sjekk om app.nettside.ai er oppe
2. Sjekk screenshots i GitHub Actions artifacts
3. Verifiser at skjema-selektorer matcher

### E-post sendes ikke
1. Verifiser at `RESEND_API_KEY` er satt korrekt
2. Sjekk at domenet er verifisert i Resend
3. Se GitHub Actions-logg for feilmeldinger

## Kontakt

Ved spørsmål: kundesenter@nettside.ai
