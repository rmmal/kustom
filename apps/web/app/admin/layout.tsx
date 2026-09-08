import type { ReactNode } from 'react';
import './admin.css';

/**
 * The admin shell. Deliberately *not* the gate: `/admin/login` lives under this layout too,
 * and a layout that redirected would loop. The gate is
 * `app/admin/(dashboard)/layout.tsx`, which wraps every page except the login one.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin">{children}</div>;
}
