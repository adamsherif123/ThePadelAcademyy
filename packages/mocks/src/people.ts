import type { Coach, CoachId, Player, PlayerId } from '@tpa/types';

import { MOCK_NOW } from './now';

export const mockCoaches: Coach[] = [
  {
    id: 'co_hany' as CoachId,
    name: 'Hany Nasser',
    bio: 'Head coach. Ex-national squash player, PPA-certified padel coach.',
    photoUrl: 'https://placehold.co/200x200?text=Hany',
    isActive: true,
  },
  {
    id: 'co_mariam' as CoachId,
    name: 'Mariam Fouad',
    bio: 'Ladies group and beginner specialist.',
    photoUrl: 'https://placehold.co/200x200?text=Mariam',
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
    photoUrl: 'https://placehold.co/200x200?text=Laila',
    isActive: false,
  },
];

/** ~8 players spread across levels and both genders. */
export const mockPlayers: Player[] = [
  { id: 'pl_omar' as PlayerId, phone: '+201001112221', name: 'Omar Sherif', gender: 'men', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_youssef' as PlayerId, phone: '+201001112222', name: 'Youssef Ali', gender: 'men', level: 'adv_beginner', createdAt: MOCK_NOW },
  { id: 'pl_tarek' as PlayerId, phone: '+201001112223', name: 'Tarek Hassan', gender: 'men', level: 'intermediate', createdAt: MOCK_NOW },
  { id: 'pl_ahmed' as PlayerId, phone: '+201001112224', name: 'Ahmed Zaki', gender: 'men', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_nour' as PlayerId, phone: '+201001112225', name: 'Nour Adel', gender: 'ladies', level: 'beginner', createdAt: MOCK_NOW },
  { id: 'pl_salma' as PlayerId, phone: '+201001112226', name: 'Salma Ibrahim', gender: 'ladies', level: 'adv_beginner', createdAt: MOCK_NOW },
  { id: 'pl_dina' as PlayerId, phone: '+201001112227', name: 'Dina Kamal', gender: 'ladies', level: 'intermediate', createdAt: MOCK_NOW },
  { id: 'pl_hana' as PlayerId, phone: '+201001112228', name: 'Hana Sabry', gender: 'ladies', level: 'beginner', createdAt: MOCK_NOW },
];

/** The player whose wallet/bookings the client-app fixtures center on. */
export const mockCurrentPlayer: Player = mockPlayers[0]!;
