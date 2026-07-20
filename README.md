# KF: City Run

Fiktiver 2D-Multiplayer-Siderunner für Node.js und HTML5.

## Start

```bash
cd kf
npm install
npm start
```

Dann `http://localhost:3000` öffnen. Für einen lokalen Multiplayer-Test das Spiel in zwei Browserfenstern öffnen.

## Steuerung

- `A/D` oder Pfeiltasten: laufen
- `W` oder Pfeil hoch: springen
- `Shift`: sprinten
- `Leertaste` oder Mausklick: schießen
- `E`: Gebäude betreten, in der Bank am Tresor Beute nehmen, Ausgang benutzen oder Ware verkaufen
- `Q`: verfügbare Waffen durchschalten
- `1` bis `4`: Pistole, Maschinenpistole, Schrotflinte oder Impulswerfer wählen
- `B`: Barrikade vor dem Spieler errichten
- `H` oder `Tab`: Top-10-Highscore öffnen und schließen

## Musik und Soundeffekte

- **Downtown Pursuit** läuft nach dem Start der Jagd automatisch als Hintergrundmusik in einer Schleife.
- Eigene Soundeffekte begleiten Pistole, Maschinenpistole, Schrotflinte, Impulswerfer, Polizeischüsse, Treffer, Rüstung, Beute, Käufe und Barrikaden.
- Der Schalter `♫ TON AN/AUS` im Statusfeld schaltet Musik und Effekte gemeinsam um. Die Einstellung wird im Browser gespeichert.
- Auf Smartphones wird Audio erst nach dem Tippen auf `Jagd starten` aktiviert, wie es die Autoplay-Regeln der mobilen Browser verlangen.

## Highscore

Die Highscore wird serverseitig in `data/highscores.json` gespeichert und bleibt nach einem Neustart erhalten. Bankbeute und Verkäufe geben keine Highscore-Punkte; entscheidend sind ausgeschaltete Polizeigegner.

| Waffe | Punkte pro Gegner |
| --- | ---: |
| Pistole | 75 |
| Maschinenpistole | 100 |
| Schrotflinte | 150 |
| Impulswerfer | 250 |

Auf dem Handy öffnet die Taste `SCORE` die Top 10. Über `DATA_DIR` kann optional ein anderer Speicherordner für die Highscore-Datei festgelegt werden.

## Rüstung, Waffen und Barrikaden

- Blaue Armor-Kisten auf der Straße geben `+50 Rüstung` und einen Barrikaden-Bausatz.
- Rüstung absorbiert Polizeischaden, bevor der Healthbalken sinkt.
- Beim Händler wird zuerst vorhandene Beute verkauft. Danach werden nacheinander Maschinenpistole (`$600`), Schrotflinte (`$1200`) und Impulswerfer (`$2000`) angeboten.
- Die Waffen unterscheiden sich bei Schaden, Feuerrate, Geschwindigkeit, Reichweite und Streuung.
- Barrikaden besitzen `180 HP`, stoppen Polizeigeschosse und bremsen Verfolger. Weitere Bausätze kosten beim vollständig freigeschalteten Händler `$250`.
- Rüstungskisten erscheinen nach 30 Sekunden erneut; Barrikaden verschwinden nach 90 Sekunden oder sobald ihre HP aufgebraucht sind.

## Bank

Stelle dich direkt vor die mittlere Banktür und drücke `E`. Im Innenraum läufst du nach rechts zum Tresor, drückst erneut `E` und kehrst anschließend links zum Ausgang zurück.

Der Port kann über die Umgebungsvariable `PORT` gesetzt werden.

## Handy-Steuerung

- Linker Stick: laufen; weit nach links oder rechts ziehen: sprinten
- Stick stark nach oben: springen
- `FEUER`: schießen
- `SPRUNG`: springen
- `E AKTION`: Bank/Gebäude betreten, Tresor benutzen oder Ware verkaufen
- `WAFFE`: verfügbare Waffen wechseln
- `BAU`: Barrikade errichten
- `SCORE`: Top-10-Highscore öffnen

Das Layout berücksichtigt Displayausschnitte und funktioniert im Hoch- und Querformat. Querformat bietet die beste Übersicht.

## HTTPS und WSS

### Coolify / Traefik (empfohlen)

Die Anwendung intern auf Port `3000` starten und in Coolify eine HTTPS-Domain zuweisen. TLS endet am Proxy; WebSockets wechseln im Browser automatisch auf `wss://`. Optional `FORCE_HTTPS=true` setzen.

### Direktes HTTPS in Node.js

```bash
SSL_KEY_PATH=/pfad/privkey.pem SSL_CERT_PATH=/pfad/fullchain.pem PORT=443 npm start
```

Ohne Zertifikat läuft Node.js intern über HTTP, was für den Betrieb hinter einem HTTPS-Reverse-Proxy korrekt ist.

## Docker Compose für city.catchiai.com

Die mitgelieferte `docker-compose.yml` verwendet dasselbe Nginx-/Traefik-Prinzip wie Goldinger. Das Node-Spiel läuft separat auf dem Host-Port `31400`. Der Nginx-Container leitet aus dem Coolify-Netzwerk auf `host.docker.internal:31400` weiter. Traefik stellt `https://city.catchiai.com` bereit; die WebSocket-Header für den Multiplayer werden vollständig weitergereicht.

```bash
PORT=31400 npm start
docker compose up -d
docker compose ps
```

Das verwendete externe Coolify-Netzwerk heißt `p2t6g68wq96tuiiau90v93w0`, entsprechend dem funktionierenden Goldinger-Beispiel. DNS-Voraussetzung: Der A-Record von `city.catchiai.com` muss auf die öffentliche IPv4-Adresse des Servers zeigen.
