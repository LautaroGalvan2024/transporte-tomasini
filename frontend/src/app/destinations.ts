export type PageId =
  | "home"
  | "trips"
  | "new-trip"
  | "account"
  | "fleet"
  | "drivers"
  | "users"
  | "obligations"
  | "reports"
  | "settings";
export type Destination = PageId | `settings?tab=holidays&year=${number}`;
