import type { OrderView, PublicOrderEvent, UserRole } from "@wejoy/domain";

export type { OrderView, PublicOrderEvent, UserRole };

export interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

export interface ApiConfig {
  nodeName: string;
  publicUrl: string;
  matchingWindowSeconds: number;
  autoCompleteSeconds: number;
  infraFeeFen: number;
  paymentProvider: string;
  registrationOpen: boolean;
  demoAccounts: Array<{
    username: string;
    password: string;
    role: UserRole;
    displayName: string;
  }>;
}

export interface MenuItem {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  category: string;
  priceFen: number;
  isAvailable: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  description: string;
  address: string;
  prepMinutes: number;
  isOpen: boolean;
  menu: MenuItem[];
}

export interface RiderProfile {
  minimumFeeFen: number;
  isAvailable: boolean;
  transport: string;
  completedDeliveries: number;
}

export interface MeResponse {
  user: User;
  profile: Merchant | RiderProfile | Record<string, never>;
}

export interface DeliveryQuote {
  riderFeeFen: number;
  networkFeeFen: number;
  eligibleRiders: number;
  matchingWindowSeconds: number;
}

export interface OperatorOverview {
  totalOrders: number;
  matchingOrders: number;
  disputedOrders: number;
  completedOrders: number;
  completedVolumeFen: number;
  networkRevenueFen: number;
  signedEvents: number;
  federatedEvents: number;
  users: Partial<Record<UserRole, number>>;
  peers: Array<{
    url: string;
    name: string | null;
    publicKey: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    receivedEvents: number;
  }>;
}

export interface FederationInfo {
  protocolVersion: string;
  name: string;
  publicUrl: string;
  nodeId: string;
  publicKey: string;
  capabilities: string[];
  personalDataFederated: boolean;
}
