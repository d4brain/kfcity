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

## Bank

Stelle dich direkt vor die mittlere Banktür und drücke `E`. Im Innenraum läufst du nach rechts zum Tresor, drückst erneut `E` und kehrst anschließend links zum Ausgang zurück.

Der Port kann über die Umgebungsvariable `PORT` gesetzt werden.

## Handy-Steuerung

- Linker Stick: laufen; weit nach links oder rechts ziehen: sprinten
- Stick stark nach oben: springen
- `FEUER`: schießen
- `SPRUNG`: springen
- `E AKTION`: Bank/Gebäude betreten, Tresor benutzen oder Ware verkaufen

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
