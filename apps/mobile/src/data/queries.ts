import type { BookingId, SlotId } from '@tpa/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  bookSlotRpc,
  cancelBookingRpc,
  fetchBookings,
  fetchCoaches,
  fetchCreditBatches,
  fetchPackages,
  fetchPurchases,
  fetchSlots,
  fetchTemplates,
  type BookReason,
  type CancelReason,
} from '../lib/api';
import { BOOKING_TOUCHED_KEYS, queryClient, queryKeys } from '../lib/queryClient';
import { getMockOverlay } from './mockPayments';

/**
 * The React Query layer: every screen's data is a hook here. Reads are cached and
 * refetched; the two money mutations invalidate the wallet / bookings / slots keys
 * so a spend or a refund shows up with NO manual refresh — the guarantee this whole
 * choice was made for. Pure @tpa/core derivations stay in the sibling data/* files;
 * these hooks just supply them live rows.
 */

/** A normalized query result — what screens gate their loading / error UI on. */
export interface Resource<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function toResource<T>(
  q: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown },
  dataOverride?: T,
): Resource<T> {
  return {
    data: dataOverride ?? q.data,
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}

// ── raw resource hooks ────────────────────────────────────────────────────────

export const useCoaches = () =>
  toResource(useQuery({ queryKey: queryKeys.coaches, queryFn: fetchCoaches }));

export const usePackages = () =>
  toResource(useQuery({ queryKey: queryKeys.packages, queryFn: fetchPackages }));

export const useSlots = () =>
  toResource(useQuery({ queryKey: queryKeys.slots, queryFn: fetchSlots }));

export const useTemplates = () =>
  toResource(useQuery({ queryKey: queryKeys.templates, queryFn: fetchTemplates }));

export const useBookings = () =>
  toResource(useQuery({ queryKey: queryKeys.bookings, queryFn: fetchBookings }));

/** The mock-purchase overlay as a query, so a purchase re-renders wallet subscribers. */
const useOverlay = () =>
  useQuery({
    queryKey: queryKeys.mockOverlay,
    queryFn: () => getMockOverlay(),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: () => getMockOverlay(),
  });

/** The player's credit batches, with any mock-purchased (overlay) batches merged in. */
export function useBatches(): Resource<import('@tpa/types').CreditBatch[]> {
  const server = useQuery({ queryKey: queryKeys.creditBatches, queryFn: fetchCreditBatches });
  const overlay = useOverlay();
  const merged = useMemo(
    () => (server.data ? [...(overlay.data?.batches ?? []), ...server.data] : undefined),
    [server.data, overlay.data],
  );
  return toResource(server, merged);
}

/** The player's purchases, with any mock purchases merged in. */
export function usePurchases(): Resource<import('@tpa/types').Purchase[]> {
  const server = useQuery({ queryKey: queryKeys.purchases, queryFn: fetchPurchases });
  const overlay = useOverlay();
  const merged = useMemo(
    () => (server.data ? [...(overlay.data?.purchases ?? []), ...server.data] : undefined),
    [server.data, overlay.data],
  );
  return toResource(server, merged);
}

/** Collapse several resources into one loading / error / retry gate for a screen. */
export function combine(...rs: Resource<unknown>[]): {
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  return {
    isPending: rs.some((r) => r.isPending),
    isError: rs.some((r) => r.isError),
    refetch: () => rs.forEach((r) => r.refetch()),
  };
}

// ── money mutations: invalidate + reconcile ───────────────────────────────────

async function refetchBookingTouched(): Promise<void> {
  await Promise.all(
    BOOKING_TOUCHED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
}

/**
 * Outcomes are DATA, never thrown. `rejected` is a business no (slot_full, …) from
 * the RPC. `unconfirmed` is the dangerous one: the request failed at the transport
 * level AFTER the server may have committed — a lost response. We never guess; we
 * re-read the server to see what actually happened, and only report `unconfirmed`
 * when even that couldn't confirm it, so the screen can offer a safe retry instead
 * of a lie.
 */
export type BookOutcome =
  | { status: 'booked'; reconciled: boolean; bookingId: BookingId }
  | { status: 'rejected'; reason: BookReason }
  | { status: 'unconfirmed' };

/** The id of a non-cancelled booking for this slot, if one landed. Reads fresh. */
async function bookedBookingId(slotId: SlotId): Promise<BookingId | null> {
  const bookings = await fetchBookings();
  return bookings.find((b) => b.slotId === slotId && b.status !== 'cancelled')?.id ?? null;
}

export function useBookSlot() {
  return useMutation<BookOutcome, never, SlotId>({
    mutationFn: async (slotId) => {
      try {
        const res = await bookSlotRpc(slotId);
        await refetchBookingTouched();
        return res.ok
          ? { status: 'booked', reconciled: false, bookingId: res.bookingId }
          : { status: 'rejected', reason: res.reason };
      } catch {
        // Transport failure — the spend may have committed. Reconcile against truth.
        const landed = await bookedBookingId(slotId).catch(() => null);
        await refetchBookingTouched();
        return landed ? { status: 'booked', reconciled: true, bookingId: landed } : { status: 'unconfirmed' };
      }
    },
  });
}

export type CancelOutcome =
  | { status: 'cancelled'; refunded: boolean; reconciled: boolean }
  | { status: 'rejected'; reason: CancelReason }
  | { status: 'unconfirmed' };

/** Is this booking now cancelled on the server? Reads fresh. */
async function bookingIsCancelled(bookingId: BookingId): Promise<boolean> {
  const bookings = await fetchBookings();
  return bookings.some((b) => b.id === bookingId && b.status === 'cancelled');
}

export function useCancelBooking() {
  return useMutation<CancelOutcome, never, { bookingId: BookingId; expectedRefund: boolean }>({
    mutationFn: async ({ bookingId, expectedRefund }) => {
      try {
        const res = await cancelBookingRpc(bookingId);
        await refetchBookingTouched();
        return res.ok
          ? { status: 'cancelled', refunded: res.refunded, reconciled: false }
          : { status: 'rejected', reason: res.reason };
      } catch {
        const cancelled = await bookingIsCancelled(bookingId).catch(() => false);
        await refetchBookingTouched();
        // If it landed, we couldn't read back the refund flag — fall back to what the
        // preview promised (isCancellableWithoutForfeit), which the RPC uses too.
        return cancelled
          ? { status: 'cancelled', refunded: expectedRefund, reconciled: true }
          : { status: 'unconfirmed' };
      }
    },
  });
}
