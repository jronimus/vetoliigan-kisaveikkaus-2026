# Vetoliigan kisaveikkaus 2026

Nopea neljan hengen MM-kisaveikkausappi GitHub Pagesiin.

## Ominaisuudet

- World Cup 2026 -ottelut ja live-tulokset rajapinnasta `https://worldcup26.ir/get/games`.
- Ottelukortit nayttavat alkamisajat Suomen ajassa. Ylen ohjelmasivu kertoo, etta sen otteluohjelma on Suomen ajassa, ja appi muuntaa API:n stadionin paikallisen ajan Suomen aikaan.
- Lukitut alkuveikkaukset pelaajille Santeri, Sami, Ilpo ja Joni.
- Pisteytys: 5 / 3 / 2 / 1 / 0 pistetta.
- Sivupalkissa sisainen pistetaulukko, maalintekijatilasto ja bonusveikkaukset.
- Maalintekijatilasto rakentuu automaattisesti rajapinnan `home_scorers` ja `away_scorers` -kentista.
- Firebase Google Auth + Firestore, kun ymparistomuuttujat on asetettu.
- Demo-tila ilman Firebasea, jotta ulkoasu ja laskenta toimivat heti paikallisesti.

## Paikallinen ajo

```bash
npm install
npm run dev
```

## Firebase-kytkenta

1. Luo Firebase-projekti.
2. Ota Authenticationissa kayttoon Google provider.
3. Lisaa Authorized domains -listaan paikallinen domain ja GitHub Pages -domain:
   - `localhost`
   - `<github-kayttaja>.github.io`
4. Luo Firestore Database.
5. Kopioi `.env.example` tiedostoksi `.env.local` ja tayta arvot.

Firestoreen luodaan automaattisesti `players`-kokoelmaan dokumentit `Santeri`, `Sami`, `Ilpo` ja `Joni`, kun sallittu kayttaja kirjautuu sisaan.

## Firestore-saannot

Naita voi kayttaa aloitussaantoina. Ne rajaavat kirjoituksen kayttajan omaan etunimeen. Lopulliseen tuotantokayttoon kannattaa lisata email-kohtainen allowlist, jos haluat varmemman rajauksen kuin pelkka displayName.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{playerId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null
        && playerId in ['Santeri', 'Sami', 'Ilpo', 'Joni']
        && request.auth.token.name.split(' ')[0] == playerId;
    }
  }
}
```

## GitHub Pages

Repo sisaltaa GitHub Actions -deployn. Kun pushaat `main`-haaraan GitHubiin:

1. Mene GitHubissa repo -> Settings -> Pages.
2. Valitse Source: `GitHub Actions`.
3. Varmista, etta repo on nimeltaan `vetoliigan-kisaveikkaus-2026`, koska Viten base-polku on asetettu sille.

Jos kaytat eri repon nimea, muuta `vite.config.ts` tiedoston `base`.

## Live-API ja CORS

`worldcup26.ir` vastaa palvelinpuolelta, mutta selaimessa se voi kaatua CORS-estoon. Appissa on siksi fallback-data, mutta oikeat live-paivitykset Pagesissa tarvitsevat pienen proxyn.

Yksinkertaisin:

1. Luo Cloudflare Worker.
2. Kopioi `cloudflare-worker.js` Workeriksi.
3. Aseta GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret:
   - `VITE_WORLDCUP_API_BASE=https://oma-worker.workers.dev/get`

Taman jalkeen GitHub Actions buildaa Pages-version, joka hakee ottelut proxyn kautta.
