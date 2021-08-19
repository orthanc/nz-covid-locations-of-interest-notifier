export interface LocationOfInterest {
  location: string;
  address: string;
  day: string;
  times: string;
  instructions?: string;
  dateAdded: string;
}

export interface LocationsOfInterest {
  group: string;
  locations: Record<string, Record<string, LocationOfInterest>>;
}

export enum ChangeType {
  ADDED = 'added',
  REMOVED = 'removed',
  UPDATED = 'updated'
}
export interface LocationOfInterestChange {
  changeType: ChangeType;
  group: string;
  location: LocationOfInterest;
}