# KF: CITY RUN

> **Die Stadt schläft nie.**

![KF City Run – Werbegrafik](KF-City-Run-Werbegrafik.png)

## Multiplayer-Action für PC und Handy

Laufe durch eine belebte Innenstadt, entkomme der Polizei und nutze die Gebäude der Stadt zu deinem Vorteil. Räume Banken aus, verstecke dich vor deinen Verfolgern und verkaufe deine Beute später bei Straßenhändlern.

Alle Spieler befinden sich gleichzeitig in derselben Stadt. Bewegungen, Polizei, Schüsse, Treffer und Aktionen werden über den Node.js-Server synchronisiert.

## Features

- 2D-Siderunner in einer detailreichen Innenstadt
- Echtzeit-Multiplayer über WebSockets
- Polizei-Verfolgung mit steigendem Fahndungslevel
- Healthbalken, Treffer und Respawn
- Begehbare Banken mit eigenem Innenraum und Tresor
- Gebäude zum Verschanzen
- Beute- und Geldsystem
- Straßenhändler zum Verkauf erbeuteter Ware
- Animierte Runner- und Polizei-Sprites
- Spielbar auf PC und Handy
- HTTPS- und WSS-Unterstützung

## Steuerung am PC

| Taste | Aktion |
| --- | --- |
| `A` / `D` oder Pfeiltasten | Laufen |
| `W` oder Pfeil nach oben | Springen |
| `Shift` | Sprinten |
| `Leertaste` oder Mausklick | Schießen |
| `E` | Gebäude betreten, Tresor benutzen oder Ware verkaufen |

## Steuerung auf dem Handy

- Linker Analogstick: laufen
- Stick weit nach links oder rechts ziehen: sprinten
- Stick nach oben oder Taste **SPRUNG**: springen
- **FEUER**: schießen
- **E AKTION**: Banken, Gebäude, Tresore und Händler benutzen

Für die beste Übersicht wird das Querformat empfohlen.

## Spiel starten

```bash
npm install
PORT=31400 npm start
```

Das Spiel läuft anschließend lokal unter:

```text
http://localhost:31400
```

## Online spielen

**[https://city.catchiai.com](https://city.catchiai.com)**

Die HTTPS-Verbindung wird über Nginx, Traefik und Let’s Encrypt bereitgestellt. Der Multiplayer verwendet automatisch eine sichere `wss://`-Verbindung.

---

**KF: CITY RUN – Multiplayer · PC & Handy**
