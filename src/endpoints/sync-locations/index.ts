import newrelic from 'newrelic';
import fetch from 'node-fetch';
import { parse, HTMLElement } from 'node-html-parser';
import { promises as fs } from 'fs';
import keyBy from 'lodash.keyby';
import isEqual from 'lodash.isequal';
import {
  ChangeType,
  LocationOfInterest,
  LocationOfInterestChange,
  LocationsOfInterest,
} from '../../types';
import { SNS, S3 } from 'aws-sdk';

interface IndexMap {
  locationIndex: number;
  addressIndex: number;
  dayIndex: number;
  timesIndex: number;
  instructionsIndex: number;
  dateAddedIndex: number;
}

const headerTests: Array<[RegExp, boolean?]> = [
  [/location/i],
  [/address/i],
  [/^day$/i],
  [/^time/i],
  [/what to do/i, false],
  [/date.added/, false],
];

const parseRow = (indexes: IndexMap, row: HTMLElement): LocationOfInterest => {
  const cells = row
    .querySelectorAll('td')
    .map((cell) => cell.textContent)
    .map((str) => str.trim().normalize());
  const location = cells[indexes.locationIndex];
  const address = cells[indexes.addressIndex];
  const day = cells[indexes.dayIndex];
  const times = cells[indexes.timesIndex];
  const instructions: string | undefined = cells[indexes.instructionsIndex];
  const dateAdded = cells[indexes.dateAddedIndex];
  return { location, address, day, times, instructions, dateAdded };
};
const parseHeader = (table: HTMLElement): IndexMap => {
  const headers = table
    .querySelector('thead')
    .querySelector('tr')
    .querySelectorAll('th')
    .map((cell) => cell.textContent.trim().toLowerCase());

  const [
    locationIndex,
    addressIndex,
    dayIndex,
    timesIndex,
    instructionsIndex,
    dateAddedIndex,
  ] = headerTests.map(([test, optional]) => {
    const index = headers.findIndex((header) => test.test(header));
    if (optional !== false && index === -1) {
      throw new Error(`Cannot find index for ${test}`);
    }
    return index;
  });

  return {
    locationIndex,
    addressIndex,
    dayIndex,
    timesIndex,
    instructionsIndex,
    dateAddedIndex,
  };
};

const parseTable = (table: HTMLElement): LocationsOfInterest => {
  const group = table.querySelector('caption').textContent;
  const indexes = parseHeader(table);
  const locations = table
    .querySelector('tbody')
    .querySelectorAll('tr')
    .map((row) => parseRow(indexes, row));
  const indexedLocations = locations.reduce<
    Record<string, Record<string, LocationOfInterest>>
  >((acc, location) => {
    const arr = acc[location.location] ?? {};
    arr[location.day + ' - ' + location.times] = location;
    acc[location.location] = arr;
    return acc;
  }, {});
  return { group, locations: indexedLocations };
};

const parseLoiPage = (html: string): Record<string, LocationsOfInterest> => {
  const root = parse(html);
  const mainSection = root.querySelector('#block-system-main');
  const tables = mainSection.querySelectorAll('table');

  const locations = keyBy(
    tables.map((table) => parseTable(table)),
    (loi) => loi.group
  );
  return JSON.parse(JSON.stringify(locations));
};

const diffLocations = (
  baseline: Record<string, LocationsOfInterest>,
  current: Record<string, LocationsOfInterest>
): Array<LocationOfInterestChange> => {
  const changes: Array<LocationOfInterestChange> = [];
  Object.entries(current).forEach(([group, currentLocationsOfInterest]) => {
    const baselineLocationsOfInterest =
      baseline[group] == null ? {} : baseline[group].locations;
    Object.entries(currentLocationsOfInterest.locations).forEach(
      ([name, currentInstances]) => {
        const baselineInstances = baselineLocationsOfInterest[name] ?? {};
        Object.entries(currentInstances).forEach(([key, currentInstance]) => {
          const baselineInstance = baselineInstances[key];

          if (baselineInstance == null) {
            changes.push({
              changeType: ChangeType.ADDED,
              group,
              location: currentInstance,
            });
          } else if (!isEqual(baselineInstance, currentInstance)) {
            changes.push({
              changeType: ChangeType.UPDATED,
              group,
              location: currentInstance,
            });
          }
        });
      }
    );
  });

  Object.entries(baseline).forEach(([group, baselineLocationsOfInterest]) => {
    const currentLocationsOfInterest =
      current[group] == null ? {} : current[group].locations;
    Object.entries(baselineLocationsOfInterest.locations).forEach(
      ([name, baselineInstances]) => {
        const currentInstances = currentLocationsOfInterest[name] ?? {};
        Object.entries(baselineInstances).forEach(([key, baselineInstance]) => {
          const currentInstance = currentInstances[key];

          if (currentInstance == null) {
            changes.push({
              changeType: ChangeType.REMOVED,
              group,
              location: baselineInstance,
            });
          }
        });
      }
    );
  });
  return changes;
};

const rawHandler = async () => {
  const result = await fetch(process.env.LOI_PAGE_URL ?? '');
  const html = await result.text();
  const locations = parseLoiPage(html);

  const s3 = new S3();
  const s3Result = await s3
    .getObject({
      Bucket: process.env.STORAGE_BUCKET_NAME ?? '',
      Key: 'locations-of-interest.json',
    })
    .promise();
  const baseline =
    s3Result.Body == null ? {} : JSON.parse(s3Result.Body.toString('utf-8'));

  const changes = diffLocations(baseline, locations);
  console.log(JSON.stringify({ changes }, undefined, 2));

  const sns = new SNS();
  await Promise.all(
    changes.map(async (change) => {
      await sns
        .publish({
          TopicArn: process.env.CHANGES_TOPIC_ARN ?? '',
          Message: JSON.stringify(change),
        })
        .promise();
    })
  );

  await s3
    .putObject({
      Bucket: process.env.STORAGE_BUCKET_NAME ?? '',
      Key: 'locations-of-interest.json',
      Body: JSON.stringify(locations),
      CacheControl: 'no-cache',
      ContentType: 'application/json',
    })
    .promise();
};

export const handler = newrelic.setLambdaHandler(rawHandler);
