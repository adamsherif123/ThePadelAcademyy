import { Eye, EyeOff } from 'lucide-react';

import { Button } from './Button';

/**
 * The one switch for every revenue figure on a page. The visible word is the
 * action ("Show" / "Hide"); the accessible name carries it with its object so it
 * still contains the visible word (voice control can say "click Show"), and
 * aria-pressed reports the state: pressed = revenue on screen.
 */
export function RevenueToggle({
  revealed,
  onChange,
  className,
}: {
  revealed: boolean;
  onChange: (revealed: boolean) => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      icon={revealed ? EyeOff : Eye}
      aria-pressed={revealed}
      aria-label={revealed ? 'Hide revenue' : 'Show revenue'}
      onClick={() => onChange(!revealed)}
      className={className}
    >
      {revealed ? 'Hide' : 'Show'}
    </Button>
  );
}
