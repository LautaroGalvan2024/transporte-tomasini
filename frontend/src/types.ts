export type Role = "ADMIN" | "DRIVER";
export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  driverId?: string | null;
}
export interface UserAccess extends User {
  createdAt: string;
  updatedAt: string;
  driverId: string | null;
  assignedTruckId: string | null;
}
export interface Truck {
  id: string;
  plate: string;
  label: string;
  active: boolean;
  initialOdometer: number;
  initialOdometerAt: string;
  odometer: number;
  odometerAt: string;
}
export interface Driver {
  id: string;
  userId: string;
  name: string;
  username: string;
  phone: string | null;
  active: boolean;
  role: Role;
  accountActive: boolean;
  assignedTruckId: string | null;
  truck?: Truck | null;
}
export interface Trip {
  id: string;
  driverId: string;
  truckId: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  allowance: string | number | null;
  notes: string | null;
  status: "ACTIVE" | "CANCELLED";
  reviewedAt: string | null;
  createdAt: string;
  version: number;
  driver: { id: string; name: string };
  truck: { id: string; plate: string; label: string };
}
export interface TripList {
  items: Trip[];
  total: number;
  page: number;
  pageSize: number;
  totals: { distanceKm: number; allowance: string | number; count: number };
}
export type ObligationStatus = "OVERDUE" | "UPCOMING" | "OK" | "UNCONFIGURED";
export interface Obligation {
  id: string;
  title: string;
  kind: "SERVICE" | "DOCUMENT";
  truckId: string | null;
  driverId: string | null;
  dueDate: string | null;
  dueKm: number | null;
  intervalMonths: number | null;
  intervalKm: number | null;
  warningDays: number;
  warningKm: number;
  notes: string | null;
  active: boolean;
  version: number;
  ownerActive: boolean;
  status: ObligationStatus;
  daysRemaining: number | null;
  kmRemaining: number | null;
  truck?: Truck | null;
  driver?: { id: string; name: string } | null;
  lastPerformedAt?: string | null;
  lastOdometer?: number | null;
}
export interface Renewal {
  id: string;
  performedAt: string;
  odometer: number | null;
  nextDueDate: string | null;
  nextDueKm: number | null;
  notes: string | null;
  createdAt: string;
}
export interface Dashboard {
  stats: {
    tripsThisMonth: number;
    kilometersThisMonth: number;
    pendingReviews: number;
    overdue: number;
    upcoming: number;
    allowanceThisMonth: string | number;
  };
  recentTrips: Trip[];
  obligations: Obligation[];
  trucks: Truck[];
  currentDriver: Driver | null;
  assignedTruck: Truck | null;
}
export interface Settings {
  recipientEmail: string | null;
  warningDays: number;
  warningKm: number;
  smtpConfigured: boolean;
  timezone: string;
  sendHour: number;
}
export interface Notification {
  id: string;
  date: string;
  recipient: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  attempts: number;
}
export type PageProps = {
  user: User;
  onNavigate: (page: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
};
export interface Invitation {
  id: string;
  role: "ADMIN" | "DRIVER";
  name: string | null;
  driverId: string | null;
  driverName: string | null;
  status: "PENDING" | "EXPIRED" | "REVOKED" | "ACCEPTED";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdByName: string;
}
export interface InvitationList {
  items: Invitation[];
  total: number;
  page: number;
  pageSize: number;
}
