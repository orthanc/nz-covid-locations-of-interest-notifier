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

const parseRow = (row: HTMLElement): LocationOfInterest => {
  let [location, address, day, times, instructions, dateAdded]: [
    string?,
    string?,
    string?,
    string?,
    string?,
    string?,
    ...any
  ] = row
    .querySelectorAll('td')
    .map((cell) => cell.textContent)
    .map((str) => str.trim().normalize());
  if (dateAdded == null) {
    dateAdded = instructions;
    instructions = undefined;
  }
  if (!instructions) {
    instructions = undefined;
  }
  return { location, address, day, times, instructions, dateAdded };
};
const parseTable = (table: HTMLElement): LocationsOfInterest => {
  const group = table.querySelector('caption').textContent;
  const locations = table
    .querySelector('tbody')
    .querySelectorAll('tr')
    .map((row) => parseRow(row));
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
  console.log(JSON.stringify({ changes }));

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
