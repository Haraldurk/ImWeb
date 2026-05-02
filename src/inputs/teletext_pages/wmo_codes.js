// WMO weather code → short text mapping.
// Used by P400 (weather today) and P401 (hourly forecast).
// Codes: https://open-meteo.com/en/docs#weathervariables

export const WMO_CODES = {
  0:  'Clear',
  1:  'Mostly clear',
  2:  'Partly cloudy',
  3:  'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Light frz drizzle',
  57: 'Frz drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light frz rain',
  67: 'Frz rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow shwr',
  95: 'Thunderstorm',
  96: 'T-storm w/ hail',
  99: 'T-storm w/ hvy hail',
};

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
];

/** Convert wind degrees (0–360) to a 16-point compass string. */
export function windDir(deg) {
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS[idx];
}
