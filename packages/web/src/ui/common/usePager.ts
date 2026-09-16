/**
 * usePager — "Load more" paging that, after 3 taps, also offers a "Load all"
 * shortcut. Shared by the admin Activity / Needs-a-look lists, the StatDetail
 * entry list, and the counter's "Recent on this terminal" list so they all page
 * identically.
 */
import { useState } from 'react';

export interface Pager {
  /** How many items to show. */
  count: number;
  /** More items remain beyond `count`. */
  canMore: boolean;
  /** Show the "Load all" shortcut (after the 3rd "Load more" tap). */
  showLoadAll: boolean;
  /** Reveal one more page. */
  more: () => void;
  /** Reveal everything. */
  loadAll: () => void;
}

export function usePager(total: number, page: number): Pager {
  const [taps, setTaps] = useState(0);
  const [all, setAll] = useState(false);
  const count = all ? total : Math.min(total, page * (taps + 1));
  return {
    count,
    canMore: count < total,
    showLoadAll: !all && taps >= 3 && count < total,
    more: () => setTaps((t) => t + 1),
    loadAll: () => setAll(true),
  };
}
