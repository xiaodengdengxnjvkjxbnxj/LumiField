# LumiField independent implementation record

The component is adapted to LumiField's existing weather data and layout:

- Open-Meteo/WMO codes and `isDay` select one icon kind;
- only the current weather and the existing seven-day forecast icons render;
- city, date, temperature, apparent temperature, humidity, wind, forecast,
  search, refresh, cache and weather-wallpaper behavior remain unchanged;
- inline SVG parts and CSS animation are authored for LumiField; no original
  SVG path, array, timing table, preview asset or English demo card is copied;
- visibility, off-screen and reduced-motion states pause or remove motion;
- no animation-frame loop, timer, media runtime or framework dependency is
  created for the icons.

The implementation may be distributed under LumiField's project license while
this independent boundary and provenance record are retained.
