export interface TicketSmsEvent {
  event_id: number;
  name: string;
  event_date: string | null; // YYYY-MM-DD
  weekday: string | null;
  month: string | null;
  year: number | null;
  location_name: string | null;
  location_full: string | null;
  cover_image_url: string | null;
  dash_url: string | null;
  shop_url: string | null;
  is_active: boolean;
  is_canceled: boolean;
  tickets_sent: number;
  total_profit: number;
  entered: number;
  time_to_end: string | null;
  synced_at: string | null;
}

export interface TicketSmsTicketType {
  id: string;
  event_id: number;
  ticket_type_id: string;
  name: string;
  description: string | null;
  price: number;
  sold: number;
  entered: number;
  total: number;
  online_sold: number;
  online_total: number;
  one_to_one_sold: number;
  one_to_one_total: number;
  box_office_sold: number;
  box_office_total: number;
  synced_at: string | null;
}

export interface TicketSmsTeamSale {
  id: string;
  event_id: number;
  pr_id: string;
  pr_name: string;
  sub_pr_count: number;
  is_self: boolean;
  sold: number;
  entered: number;
  total: number;
  synced_at: string | null;
}

export type TicketSmsSyncState = 'ok' | 'session_expired' | 'error';

export interface TicketSmsSyncStatus {
  id: number;
  status: TicketSmsSyncState;
  events_synced: number;
  message: string;
  synced_at: string | null;
}
