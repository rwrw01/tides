# 🌊 Eb & Vloed Verkenner

Interactieve webapp: prik een pin op de kaart en zie de actuele eb- en vloedstanden voor die plek —
volgend hoog-/laagwater, getijverschil, getijtype en een grafiek van vier dagen. Met interactieve uitleg
over waarom het getij in de Middellandse Zee (± 20 cm) zo veel kleiner is dan in de Golf van Biskaje
(3–5 m): amfidromische punten, resonantie en opstuwing op het continentaal plat. Inclusief een
"getijdenmixer" waarmee je zelf spring- en doodtij bouwt uit de harmonische componenten M2, S2 en K1.

**Gebruik:** open `index.html` in een browser, of activeer GitHub Pages voor deze repo
(Settings → Pages → deploy from branch `main`).

## Data & techniek

- Waterstanden: [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)
  (`sea_level_height_msl`, gratis, geen API-key). Hoogtes t.o.v. gemiddeld zeeniveau (MSL),
  model ± 8 km resolutie — **niet voor navigatie**.
- Kaart: [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org).
- Verder geen dependencies: één zelfstandig HTML-bestand, grafieken in eigen SVG,
  hoog-/laagwatertijden bepaald met paraboolinterpolatie op de uurlijkse reeks.

## Colofon

Gemaakt door **Ralph Wagter** met [Claude Code](https://claude.ai/code).
Vrij hergebruik onder [EUPL-1.2](https://eupl.eu/).
