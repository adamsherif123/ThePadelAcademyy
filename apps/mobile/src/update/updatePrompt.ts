import { cairoCalendarDate } from '@tpa/core';
import type { IsoInstant } from '@tpa/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'tpa.updatePrompt.dismissedOn';

/**
 * The once-per-day gate for the update prompt.
 *
 * The day boundary is CAIRO, not the device — every other date in this app is a
 * Cairo day (session times, credit expiry, the admin's hours metric), and the
 * academy is a single physical club in one timezone. A device-local day would mean
 * a traveller's "tomorrow" arrived at a different moment from everyone else's, for
 * no benefit.
 *
 * Stored as a plain 'YYYY-MM-DD' string: readable when debugging, and comparing two
 * of them is string equality with no parsing.
 */
export function cairoDayKey(now: IsoInstant): string {
  const d = cairoCalendarDate(now);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** The Cairo day the prompt was last answered on, or null if never / unreadable. */
export async function readDismissedOn(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — treat as "never dismissed". Worst case the user sees the
    // prompt once more than intended, which beats suppressing it forever because a
    // read failed.
    return null;
  }
}

/** Record that the prompt was answered today, so it stays away until tomorrow. */
export async function markDismissedToday(now: IsoInstant): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, cairoDayKey(now));
  } catch {
    // Non-fatal: the bridge's per-session guard still stops it re-appearing before
    // the app is relaunched.
  }
}
