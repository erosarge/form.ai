import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse .env.local manually
const envPath = join(__dirname, '.env.local');
const env = {};
try {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
} catch (e) {
  console.error('Could not read .env.local:', e.message);
  process.exit(1);
}

const API_KEY = env.INTERVALS_ICU_API_KEY;
const ATHLETE_ID = env.INTERVALS_ICU_ATHLETE_ID;

if (!API_KEY || !ATHLETE_ID) {
  console.error('Missing INTERVALS_ICU_API_KEY or INTERVALS_ICU_ATHLETE_ID in .env.local');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`API_KEY:${API_KEY}`).toString('base64');
const headers = { Authorization: auth, 'Content-Type': 'application/json' };

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function printNonNull(label, obj, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return;
    console.log(`${pad}[array, ${obj.length} items]`);
    printNonNull(label + '[0]', obj[0], indent);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const nonNullChildren = Object.entries(v).filter(([, cv]) => cv !== null && cv !== undefined);
        if (nonNullChildren.length > 0) {
          console.log(`${pad}${k}:`);
          printNonNull(k, v, indent + 2);
        }
      } else if (Array.isArray(v)) {
        if (v.length > 0) {
          console.log(`${pad}${k}: [array, ${v.length} items, first item sample below]`);
          if (typeof v[0] === 'object') printNonNull(k + '[0]', v[0], indent + 2);
          else console.log(`${pad}  ${v[0]}`);
        }
      } else {
        console.log(`${pad}${k}: ${v}`);
      }
    }
  }
}

// 1. Fetch recent activities
const activitiesUrl = `https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/activities?oldest=2026-04-01&newest=2026-04-05`;
console.log('Fetching activities list...');
console.log('URL:', activitiesUrl);

let activities;
try {
  activities = await fetchJSON(activitiesUrl);
} catch (e) {
  console.error('Failed to fetch activities:', e.message);
  process.exit(1);
}

if (!activities || activities.length === 0) {
  console.log('No activities found in range 2026-04-01 to 2026-04-05');
  process.exit(0);
}

console.log(`\nFound ${activities.length} activities. Using first: ${activities[0].id} — ${activities[0].name}`);

const activityId = activities[0].id;

// 2. Fetch full activity detail
const detailUrl = `https://intervals.icu/api/v1/activity/${activityId}`;
console.log('\n--- Full Activity Detail ---');
console.log('URL:', detailUrl);
let detail;
try {
  detail = await fetchJSON(detailUrl);
} catch (e) {
  console.error('Failed to fetch activity detail:', e.message);
}

if (detail) {
  console.log('\nAll non-null fields in activity detail:');
  printNonNull('detail', detail);
}

// 3. Fetch laps
const lapsUrl = `https://intervals.icu/api/v1/activity/${activityId}/laps`;
console.log('\n--- Activity Laps ---');
console.log('URL:', lapsUrl);
let laps;
try {
  laps = await fetchJSON(lapsUrl);
} catch (e) {
  console.error('Failed to fetch laps:', e.message);
}

if (laps) {
  if (Array.isArray(laps)) {
    console.log(`\nFound ${laps.length} laps.`);
    if (laps.length > 0) {
      console.log('\nFirst lap — all non-null fields:');
      printNonNull('lap[0]', laps[0]);
      if (laps.length > 1) {
        console.log('\nSecond lap — all non-null fields (for comparison):');
        printNonNull('lap[1]', laps[1]);
      }
    }
  } else {
    console.log('\nLaps response (non-null fields):');
    printNonNull('laps', laps);
  }
}

// 4. Fetch streams
const streamsUrl = `https://intervals.icu/api/v1/activity/i136873607/streams`;
console.log('\n--- Activity Streams ---');
console.log('URL:', streamsUrl);
let streams;
try {
  streams = await fetchJSON(streamsUrl);
} catch (e) {
  console.error('Failed to fetch streams:', e.message);
}

if (streams) {
  if (Array.isArray(streams)) {
    console.log(`\nFound ${streams.length} streams.`);
    console.log('\nStream type names:');
    for (const s of streams) {
      const type = s.type ?? s.name ?? s.key ?? JSON.stringify(Object.keys(s));
      console.log(' -', type);
    }
    if (streams.length > 0) {
      console.log('\nFirst stream object keys:', Object.keys(streams[0]).join(', '));
    }
  } else if (streams && typeof streams === 'object') {
    console.log('\nStreams response keys:', Object.keys(streams).join(', '));
    printNonNull('streams', streams);
  }
}

// 5. Fetch intervals endpoint
const intervalsUrl = `https://intervals.icu/api/v1/activity/i136873607/intervals`;
console.log('\n--- Activity Intervals Endpoint ---');
console.log('URL:', intervalsUrl);
let intervals;
try {
  intervals = await fetchJSON(intervalsUrl);
} catch (e) {
  console.error('Failed to fetch intervals:', e.message);
}

if (intervals) {
  if (Array.isArray(intervals)) {
    console.log(`\nFound ${intervals.length} intervals.`);
    if (intervals.length > 0) {
      console.log('\nFirst interval — all non-null fields:');
      printNonNull('interval[0]', intervals[0]);
      if (intervals.length > 1) {
        console.log('\nSecond interval — all non-null fields:');
        printNonNull('interval[1]', intervals[1]);
      }
    }
  } else {
    console.log('\nIntervals response (non-null fields):');
    printNonNull('intervals', intervals);
  }
}
