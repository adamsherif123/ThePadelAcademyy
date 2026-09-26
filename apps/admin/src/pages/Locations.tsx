import type { Location } from '@tpa/types';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { locationsForDisplay } from '../data/locations';
import { useAdminData } from '../data/queries';
import { LocationModal } from '../locations/LocationModal';
import { Badge, Button, ErrorView, LoadingView, PageHeader } from '../ui';
import styles from './Locations.module.css';

/**
 * Locations route: the academy's branches.
 *
 * Read-only in one respect that is worth stating — there is no delete. Sessions,
 * recurring rules and packages all reference a branch, so removing one would
 * either orphan that history or cascade into it; a branch is retired by turning
 * it off, the same way a coach or a package is.
 *
 * The default branch carries a badge and no off switch: every pre-1.4 binary is
 * pinned to it and cannot be told otherwise.
 */
export function Locations() {
  const data = useAdminData();
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  const locations = locationsForDisplay(data.locations);

  return (
    <div>
      <div className={styles.head}>
        <PageHeader
          eyebrow="Operations"
          title="Locations"
          subtitle="The academy's branches. Every session, recurring rule and package belongs to exactly one of them."
        />
        <Button icon={Plus} onClick={() => setEditing('new')}>
          Add branch
        </Button>
      </div>

      <div className={styles.list}>
        {locations.map((loc) => (
          <div key={loc.id} className={styles.row} data-inactive={!loc.isActive}>
            <span className={styles.pin} aria-hidden>
              <MapPin size={18} />
            </span>
            <div className={styles.main}>
              <span className={styles.name}>
                {loc.name}
                {loc.isDefault ? <Badge tone="info">Original</Badge> : null}
                {!loc.isActive ? <Badge tone="neutral">Closed</Badge> : null}
              </span>
              <span className={styles.meta}>{loc.address}</span>
              <span className={styles.meta}>{loc.hoursText}</span>
            </div>
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(loc)}>
              Edit
            </Button>
          </div>
        ))}
      </div>

      {editing ? (
        <LocationModal
          location={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
