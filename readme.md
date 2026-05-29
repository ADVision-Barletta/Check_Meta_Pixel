# Meta Pixel Check

Monitoraggio automatico della presenza del Meta Pixel (ex Facebook Pixel) su uno o più siti web, con report via email e interfaccia di configurazione web.

## Come funziona

1. Lo scan controlla ogni sito della lista e verifica se il pixel Meta è installato
2. Per i siti con loader dinamici (GTM, ecc.), apre Chrome via Puppeteer per un controllo approfondito
3. Invia un report email con riepilogo (OK / KO)
4. I log di ogni scan sono salvati nella cartella `logs/`

## Configurazione rapida

### 1. Fork / clone

```bash
git clone https://github.com/<tuo-utente>/Check_Meta_Pixel.git
cd Check_Meta_Pixel
npm install
```

### 2. Variabili d'ambiente (SMTP per l'invio email)

Copia `.env.example` in `.env` e compila:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tua@email.com
SMTP_PASS=password_app
SMTP_FROM=tua@email.com
```

Poi imposta gli stessi valori come **Actions secrets** su GitHub:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### 3. Configurazione via web (consigliata)

Apri `index.html` nel browser, inserisci un **GitHub Personal Access Token** (permessi `repo`) e configura:
- Email destinatario del report (uno o più indirizzi separati da `;`)
- Orario e frequenza scan (giornaliero, settimanale o mensile)
- Lista siti da controllare

I dati vengono salvati direttamente su GitHub nel file `config.json`.

### 4. Esecuzione manuale

Dalla web interface: **Avvia scan ora** → triggera `workflow_dispatch` su GitHub Actions.

In locale:
```bash
node check-pixel.js
```

Con invio email:
```bash
node check-pixel.js --email-to destinatario@email.it
```

### 5. Scan programmato

Il workflow GitHub Actions (`scan.yml`) esegue lo scan ogni ora. Lo scheduler (`scheduler.js`) verifica se l'orario e la frequenza corrispondono alla configurazione prima di procedere.

## Frequenze supportate

- **Ogni giorno** — esecuzione giornaliera all'orario impostato
- **Giorni specifici** — esecuzione solo nei giorni selezionati (es. Lun, Mer, Ven)
- **Una volta al mese** — esecuzione il giorno del mese scelto (es. il 15 di ogni mese)

## Struttura del progetto

```
├── .github/workflows/scan.yml   # Workflow GitHub Actions
├── check-pixel.js               # Script principale di scan
├── scheduler.js                 # Filtro scheduling (giorno/ora/frequenza)
├── notify.js                    # Invio report via email (nodemailer)
├── index.html                   # Interfaccia di configurazione web
├── config.json                  # Configurazione (email, orario, siti, ...)
├── sites.txt                    # Lista siti generata da config.json
├── logs/                        # Log degli scan
├── watch.js                     # (opzionale) Scan continuo in locale
├── package.json
└── readme.md
```

## Segreti GitHub richiesti

| Segreto       | Descrizione                     |
|---------------|---------------------------------|
| `SMTP_HOST`   | Server SMTP (es. smtp.gmail.com) |
| `SMTP_PORT`   | Porta SMTP (587)                |
| `SMTP_USER`   | Utente SMTP                     |
| `SMTP_PASS`   | Password SMTP (o app password)  |
| `SMTP_FROM`   | Mittente email                  |

## Licenza

MIT
