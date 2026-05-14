// ===================================================
// TEST DATA: Norske testbedrifter
// VERSION: 1.0
// ===================================================

export interface TestBedrift {
  firmanavn: string;
  forretningside: string;
  fornavn: string;
  etternavn: string;
  epostPrefix: string;
  epostDomene: string;
  telefon: string;
  passord: string;
}

export const testBedrifter: TestBedrift[] = [
  {
    firmanavn: "Hansens Rørlegger AS",
    forretningside: "Vi er et rørleggerfirma i Oslo som tilbyr vedlikehold og renovering av bad",
    fornavn: "Hans Erik",
    etternavn: "Hansen",
    epostPrefix: "hans",
    epostDomene: "hansens-rorlegger.no",
    telefon: "90000001",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Klipp & Kruller Frisør",
    forretningside: "Frisørsalong i Bergen sentrum med fokus på moderne frisyrer og hårpleie for hele familien",
    fornavn: "Linda",
    etternavn: "Kristiansen",
    epostPrefix: "linda",
    epostDomene: "klippogkruller.no",
    telefon: "90000002",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Pizzeria Napoli",
    forretningside: "Italiensk restaurant i Trondheim som serverer autentisk napolitansk pizza og pasta",
    fornavn: "Marco",
    etternavn: "Rossi",
    epostPrefix: "marco",
    epostDomene: "pizzeria-napoli.no",
    telefon: "90000003",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Ren & Skinn Renhold",
    forretningside: "Profesjonelt renhold for bedrifter og private i Stavanger-området",
    fornavn: "Kari",
    etternavn: "Johansen",
    epostPrefix: "kari",
    epostDomene: "renogskinn.no",
    telefon: "90000004",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Bjørnsen Elektro",
    forretningside: "Elektriker i Drammen som utfører alt fra småreparasjoner til nyinstallasjoner",
    fornavn: "Ole",
    etternavn: "Bjørnsen",
    epostPrefix: "ole",
    epostDomene: "bjornsen-elektro.no",
    telefon: "90000005",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Solsikken Blomster",
    forretningside: "Blomsterbutikk i Kristiansand med fokus på brudebukett, begravelse og hverdagsglede",
    fornavn: "Ingrid",
    etternavn: "Solberg",
    epostPrefix: "ingrid",
    epostDomene: "solsikkenblomster.no",
    telefon: "90000006",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Kaffebrenneriet Mølla",
    forretningside: "Lokalt kaffebrenneri i Fredrikstad som leverer nybrente bønner til bedrifter og private",
    fornavn: "Erik",
    etternavn: "Møllerstad",
    epostPrefix: "erik",
    epostDomene: "kaffebrenneriet-molla.no",
    telefon: "90000007",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Aktiv Fysioterapi",
    forretningside: "Fysioterapiklinikk i Tromsø med spesialisering på idrettsskader og rehabilitering",
    fornavn: "Silje",
    etternavn: "Nordmann",
    epostPrefix: "silje",
    epostDomene: "aktivfysioterapi.no",
    telefon: "90000008",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Bildoktoren AS",
    forretningside: "Bilverksted i Sandnes som tilbyr EU-kontroll, service og reparasjoner for alle bilmerker",
    fornavn: "Terje",
    etternavn: "Bilstad",
    epostPrefix: "terje",
    epostDomene: "bildoktoren.no",
    telefon: "90000009",
    passord: "TestPassord123!"
  },
  {
    firmanavn: "Advokat Lund & Co",
    forretningside: "Advokatfirma i Ålesund med fokus på familierett, arv og eiendom",
    fornavn: "Marte",
    etternavn: "Lund",
    epostPrefix: "marte",
    epostDomene: "advokatlund.no",
    telefon: "90000010",
    passord: "TestPassord123!"
  }
];

/**
 * Henter dagens testbedrift basert på dag i året
 * Roterer gjennom alle 10 bedrifter
 */
export function getDagensBedrift(): TestBedrift {
  const dagIAret = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const index = dagIAret % testBedrifter.length;
  return testBedrifter[index];
}

/**
 * Genererer unik e-post med timestamp
 */
export function genererUnikEpost(bedrift: TestBedrift): string {
  const timestamp = Date.now();
  return `${bedrift.epostPrefix}-${timestamp}@${bedrift.epostDomene}`;
}
