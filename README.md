# Vetoliigan kisaveikkaus 2026

Nopea ja moderni neljän hengen MM-kisaveikkausappi, joka on suunniteltu erityisesti vuoden 2026 kisoja varten. Sovellus tarjoaa saumattoman käyttökokemuksen tulosten veikkaamiseen ja live-tulosten seuraamiseen.

## Ominaisuudet

- **Live-tulokset ja otteluohjelma**: Hakee ottelut ja päivittää tulokset sekä alkamisajat reaaliajassa (Suomen ajassa).
- **Pistetaulukko ja maalipörssi**: Automaattinen pistelaskenta otteluiden ja tehtyjen maalien perusteella (Pisteytys 5 Täysin oikea tulos, 3 Oikea maaliero ja merkki, 2 Oikea merkki väärä maaliero, 2 Tasapeli oikein väärät maalit, 1 Toisen joukkueen maalimäärä oikein tulos väärin).
- **Bonusveikkaukset**: Maalikuninkaan, mestarin, flopin ja yllättäjän valinta.
- **Laitteiden välinen synkronointi**: Tukee reaaliaikaista synkronointia ja tallennusta Firebase Firestoren avulla, suojattuna Google-kirjautumisella.
- **Offline- ja optimistinen UI**: Toimii sulavasti paikallisen välimuistin avulla, eikä jäädy verkkoyhteysongelmissa.

## Teknologiat

- **Frontend**: React, TypeScript, Vite
- **Tyylit**: Puhdas Vanilla CSS, responsiivinen design ja modernit animaatiot
- **Backend & Tietokanta**: Firebase Authentication (Google Login), Firestore
- **Hosting**: GitHub Pages

## Paikallinen kehitys

```bash
npm install
npm run dev
```

## Live-datan cache-proxy

Sovellus voi hakea MM-datan Cloudflare Workerin kautta, jolloin käyttäjien selaimet eivät osu suoraan alkuperäiseen APIin. Aseta frontendin buildiin:

```bash
VITE_WORLDCUP_API_BASE=https://vetoliiga-worldcup-proxy.<cloudflare-subdomain>.workers.dev/get
```

Worker cachettaa `games`-datan lyhyesti, `groups`-datan vähän pidemmäksi ajaksi ja `teams`/`stadiums`-datan pitkäksi ajaksi.

Julkaisu:

```bash
npx wrangler login
npm run deploy:worker
```

Kun Worker on julkaistu, lisää sen `/get`-päätteinen osoite GitHub-repon secretiksi nimellä `VITE_WORLDCUP_API_BASE`. GitHub Pages -workflow käyttää sitä seuraavassa buildissä automaattisesti.
