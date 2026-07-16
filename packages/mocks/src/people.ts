import type { Coach, CoachId, Player, PlayerId } from '@tpa/types';

import { generatedPlayers } from './generated';
import { MOCK_NOW } from './now';

// photoUrl is null across the fixtures: mocks must not depend on a live external
// image service (offline/dev reliability). The Avatar falls back to initials.
// Production photos come from Supabase Storage (S9); Avatar's onError fallback
// covers real failures there too.
export const mockCoaches: Coach[] = [
  {
    id: 'co_hany' as CoachId,
    name: 'Hany Nasser',
    bio: 'Head coach. Ex-national squash player, PPA-certified padel coach.',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'co_mariam' as CoachId,
    name: 'Mariam Fouad',
    bio: 'Ladies group and beginner specialist.',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'co_karim' as CoachId,
    name: 'Karim Adel',
    bio: 'Individual and duo performance coaching.',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'co_laila' as CoachId,
    name: 'Laila Mostafa',
    bio: 'Junior development. Currently on leave.',
    photoUrl: null,
    isActive: false,
  },
];

/**
 * The hand-tuned core players (client-app fixtures center on pl_omar at index 0).
 * The academy-scale generated players are APPENDED after these — never before —
 * so pl_omar stays index 0 and mockCurrentPlayer is unchanged.
 */
const handPlayers: Player[] = [
  { id: 'pl_omar' as PlayerId, phone: '+201001112221', name: 'Omar Sherif', gender: 'men', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_youssef' as PlayerId, phone: '+201001112222', name: 'Youssef Ali', gender: 'men', level: 'adv_beginner', createdAt: MOCK_NOW },
  { id: 'pl_tarek' as PlayerId, phone: '+201001112223', name: 'Tarek Hassan', gender: 'men', level: 'intermediate', createdAt: MOCK_NOW },
  { id: 'pl_ahmed' as PlayerId, phone: '+201001112224', name: 'Ahmed Zaki', gender: 'men', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_nour' as PlayerId, phone: '+201001112225', name: 'Nour Adel', gender: 'ladies', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_salma' as PlayerId, phone: '+201001112226', name: 'Salma Ibrahim', gender: 'ladies', level: 'adv_beginner', createdAt: MOCK_NOW },
  { id: 'pl_dina' as PlayerId, phone: '+201001112227', name: 'Dina Kamal', gender: 'ladies', level: 'intermediate', createdAt: MOCK_NOW },
  { id: 'pl_hana' as PlayerId, phone: '+201001112228', name: 'Hana Sabry', gender: 'ladies', level: 'beginner', createdAt: MOCK_NOW },
];

/** ~104 players: the hand-tuned core + academy-scale generated ones. */
export const mockPlayers: Player[] = [...handPlayers, ...generatedPlayers];

/** The player whose wallet/bookings the client-app fixtures center on. */
export const mockCurrentPlayer: Player = mockPlayers[0]!;
