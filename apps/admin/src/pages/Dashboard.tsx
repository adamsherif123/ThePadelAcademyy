import { formatPiastres } from '@tpa/core';
import type { Piastres } from '@tpa/types';
import {
  MOCK_NOW,
  mockBookings,
  mockCoaches,
  mockPackages,
  mockPlayers,
  mockPurchases,
  mockSlots,
} from '@tpa/mocks';

/**
 * S1 proof page (throwaway, default styling): counts and a formatted total from
 * @tpa/mocks, the total formatted via @tpa/core. Proves @tpa/types + @tpa/core +
 * @tpa/mocks resolve and run in the browser bundle.
 */
export function Dashboard() {
  const upcomingSlots = mockSlots.filter(
    (s) => new Date(s.startsAt).getTime() > new Date(MOCK_NOW).getTime(),
  ).length;

  const succeededRevenue = mockPurchases
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => (sum + p.amount) as Piastres, 0 as Piastres);

  const stats: { label: string; value: string | number }[] = [
    { label: 'Coaches', value: mockCoaches.length },
    { label: 'Players', value: mockPlayers.length },
    { label: 'Packages', value: mockPackages.length },
    { label: 'Upcoming slots', value: upcomingSlots },
    { label: 'Bookings', value: mockBookings.length },
    { label: 'Purchases', value: mockPurchases.length },
    { label: 'Succeeded revenue', value: formatPiastres(succeededRevenue) },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <ul>
        {stats.map((s) => (
          <li key={s.label}>
            {s.label}: {s.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
