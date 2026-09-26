import type { Location } from '@tpa/types';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { createLocation, setLocationActive, updateLocation } from '../data/locations';
import { Button, Input, Modal, Toggle } from '../ui';
import styles from './LocationModal.module.css';

/** Shared fallback for transport failures and any reason this view doesn't name. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * The deactivation refusals, as sentences. Each one names what is in the way and
 * what to do about it — the RPC returns the count, so the copy can be specific
 * rather than "this location is in use".
 */
function deactivateError(reason: string, slots: number, templates: number): string {
  switch (reason) {
    case 'default_location':
      return 'This is the original branch — it can’t be deactivated. Every older version of the app is pinned to it.';
    case 'has_future_slots':
      return `${slots} upcoming session${slots === 1 ? '' : 's'} ${slots === 1 ? 'is' : 'are'} still scheduled here. Cancel or move ${slots === 1 ? 'it' : 'them'} first.`;
    case 'has_active_templates':
      return `${templates} recurring rule${templates === 1 ? '' : 's'} still generate${templates === 1 ? 's' : ''} sessions here. Pause ${templates === 1 ? 'it' : 'them'} first.`;
    case 'location_missing':
      return 'That branch no longer exists. Close and reopen this page.';
    case 'not_admin':
      return 'You don’t have permission.';
    default:
      return GENERIC_ERROR;
  }
}

/**
 * Add or edit a branch.
 *
 * Mirrors CoachModal: a plain INSERT/UPDATE behind is_admin(), not an RPC,
 * because creating a branch is config rather than money. Two fields are absent
 * on purpose and cannot be added here — `id` (the database mints it; the API
 * holds no privilege on the column) and `isDefault` (the pin every pre-1.4
 * client resolves to, which only a migration may move).
 *
 * Deactivation is the one action that does go through an RPC, because it can
 * refuse: see the guard in migration 061 and the copy above.
 */
export function LocationModal({ location, onClose }: { location?: Location; onClose: () => void }) {
  const editing = location !== undefined;
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [mapsUrl, setMapsUrl] = useState(location?.mapsUrl ?? '');
  const [hoursText, setHoursText] = useState(location?.hoursText ?? '');
  const [sortOrder, setSortOrder] = useState(String(location?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = {
    name: name.trim(),
    address: address.trim(),
    mapsUrl: mapsUrl.trim(),
    hoursText: hoursText.trim(),
  };
  // The same shape the CHECK enforces, so a typo is a disabled button rather
  // than a 23514 the admin has to decode.
  const urlValid = /^https?:\/\/\S+$/.test(trimmed.mapsUrl);
  const canSave =
    trimmed.name !== '' && trimmed.address !== '' && trimmed.hoursText !== '' && urlValid && !busy;

  const onSave = async () => {
    setError(null);
    setBusy(true);
    const fields = { ...trimmed, sortOrder: Number.parseInt(sortOrder, 10) || 0 };
    const res = editing ? await updateLocation(location.id, fields) : await createLocation(fields);
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.reason === 'network' ? GENERIC_ERROR : 'Could not save the branch.');
  };

  const onToggleActive = async (next: boolean) => {
    if (!editing) return;
    setError(null);
    setBusy(true);
    const res = await setLocationActive(location.id, next);
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.ok === false && 'slots' in res ? deactivateError(res.reason, res.slots, res.templates) : GENERIC_ERROR);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Locations"
      title={editing ? location.name : 'Add a branch'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void onSave()} disabled={!canSave}>
            {editing ? 'Save changes' : 'Add branch'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Oro Plaza Hotel" />
        <Input
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="In front of Family Park, Cairo"
        />
        <Input
          label="Maps link"
          value={mapsUrl}
          onChange={(e) => setMapsUrl(e.target.value)}
          placeholder="https://maps.google.com/?q=..."
          hint={mapsUrl.trim() !== '' && !urlValid ? 'That needs to be a full link starting with http:// or https://' : undefined}
        />
        <Input
          label="Opening hours"
          value={hoursText}
          onChange={(e) => setHoursText(e.target.value)}
          placeholder="Sun – Wed · 5:00 PM – 11:00 PM"
          hint="Shown on the branch card in the app — free text."
        />
        <Input
          label="Sort order"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />

        {editing ? (
          <div className={styles.activeRow}>
            <Toggle
              checked={location.isActive}
              onChange={(next) => {
                // The default branch has no off switch at all — the RPC would
                // refuse it, and offering a control that always fails is worse
                // than not offering one.
                if (!location.isDefault && !busy) void onToggleActive(next);
              }}
              label="Open for business"
            />
            {location.isDefault ? (
              <p className={styles.hint}>
                The original branch stays active — every older version of the app is pinned to it.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className={styles.error}>
            <AlertTriangle size={14} aria-hidden /> {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
