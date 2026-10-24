// Live updates: the app polls /api/sync and bumps this counter whenever something the person can see changes.
// Every useLoad() and open KPI re-reads its data quietly when it moves, so nobody has to refresh the page.
import { createContext, useContext } from 'react';

export const LiveCtx = createContext(0);
export const useLiveTick = () => useContext(LiveCtx);
