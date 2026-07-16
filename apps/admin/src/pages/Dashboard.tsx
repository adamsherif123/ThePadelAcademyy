import { PageHeader } from '../ui';

/** Dashboard route. Body (KPIs, charts, live panels) lands in S4b. */
export function Dashboard() {
  return (
    <PageHeader
      eyebrow="Good morning, Rania"
      title="Dashboard"
      subtitle="The state of The Padel Academy for July — revenue, players, sessions, and what needs your attention today."
    />
  );
}
