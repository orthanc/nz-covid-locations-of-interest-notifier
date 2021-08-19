import newrelic from 'newrelic';
import fetch from 'node-fetch';
import { parse, HTMLElement } from 'node-html-parser';
import {promises as fs} from 'fs';
import keyBy from 'lodash.keyby';
import isEqual from 'lodash.isequal';

interface LocationOfInterest {
  location: string;
  address: string;
  day: string;
  times: string;
  instructions?: string;
  dateAdded: string;
}
interface LocationsOfInterest {
  group: string;
  locations: Record<string, Record<string, LocationOfInterest>>;
}

const parseRow = (row: HTMLElement): LocationOfInterest => {
  let [location, address, day, times, instructions, dateAdded]: [string?, string?, string?, string?, string?, string?, ...any] = row.querySelectorAll('td').map(cell => cell.textContent).map(str => str.trim().normalize());
  if (dateAdded == null) {
    dateAdded = instructions;
    instructions = undefined;
  }
  if (!instructions) {
    instructions = undefined;
  }
  return {location, address, day, times, instructions, dateAdded};
}
const parseTable = (table: HTMLElement): LocationsOfInterest => {
  const group = table.querySelector('caption').textContent;
  const locations = table.querySelector('tbody').querySelectorAll('tr').map(row => parseRow(row));
  const indexedLocations = locations.reduce<Record<string, Record<string, LocationOfInterest>>>((acc, location) => {
    const arr = acc[location.location] ?? {};
    arr[location.day + ' - ' + location.times] = location;
    acc[location.location] = arr;
    return acc;
  }, {});
  return {group, locations: indexedLocations}

}

const parseLoiPage = (html: string): Record<string, LocationsOfInterest> => {
  const root = parse(html)
  const mainSection = root.querySelector('#block-system-main');
  const tables = mainSection.querySelectorAll('table');
  
  const locations = keyBy(tables.map(table => parseTable(table)), loi => loi.group);
  return JSON.parse(JSON.stringify(locations));
}

const diffLocations = (baseline: Record<string, LocationsOfInterest>, current: Record<string, LocationsOfInterest>) => {
  Object.entries(current).forEach(([group, currentLocationsOfInterest]) => {
    const baselineLocationsOfInterest = baseline[group] == null ? {} : baseline[group].locations;
    Object.entries(currentLocationsOfInterest.locations).forEach(([name, currentInstances]) => {
      const baselineInstances = baselineLocationsOfInterest[name] ?? {}
      Object.entries(currentInstances).forEach(([key, currentInstance]) => {
        const baselineInstance = baselineInstances[key];

        if (baselineInstance == null) {
          console.log(`New LOI: ${JSON.stringify(currentInstance)}`)
        } else if (!isEqual(baselineInstance, currentInstance)) {
          console.log(`Updated LOI: ${JSON.stringify(currentInstance)}`);
        }
      })
    })
  })

  Object.entries(baseline).forEach(([group, baselineLocationsOfInterest]) => {
    const currentLocationsOfInterest = current[group] == null ? {} : current[group].locations;
    Object.entries(baselineLocationsOfInterest.locations).forEach(([name, baselineInstances]) => {
      const currentInstances = currentLocationsOfInterest[name] ?? {}
      Object.entries(baselineInstances).forEach(([key, baselineInstance]) => {
        const currentInstance = currentInstances[key];

        if (currentInstance == null) {
          console.log(`Removed LOI: ${JSON.stringify(baselineInstance)}`)
        }
      })
    })
  })
}

const rawHandler = async () => {
  const result = await fetch(process.env.LOI_PAGE_URL ?? '');
  const html = await result.text();
  const locations = parseLoiPage(html);
  // await fs.writeFile('vaseline.json', JSON.stringify(locations, undefined, 2));
  const baseline = JSON.parse(await fs.readFile('baseline.json', 'utf-8'));

  diffLocations(baseline, locations);
};

export const handler = newrelic.setLambdaHandler(rawHandler);