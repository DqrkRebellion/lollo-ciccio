import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://inltzlcgccfnblfepnkw.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlubHR6bGNnY2NmbmJsZmVwbmt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwOTU0NTUsImV4cCI6MjExMDY3MTQ1NX0.e9HPwrgvjBg7kNMSmLWESQJ0aX2-m0dSOD2gITW3C1M';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export const TEAM_ACCOUNTS = [
  {
    promoterId: 'lollo',
    email: 'lollo@lollociccio.app',
    displayName: 'Lollo',
    fullName: 'Lorenzo Biondi',
    initials: 'LB',
    color: '#0071E3',
  },
  {
    promoterId: 'ciccio',
    email: 'ciccio@lollociccio.app',
    displayName: 'Ciccio',
    fullName: 'Francesco Troiano',
    initials: 'FT',
    color: '#5856D6',
  },
] as const;
