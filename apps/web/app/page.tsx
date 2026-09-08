import { ROLES } from '@customs/core';

/**
 * Tonight page. M3.4 makes it live off Supabase Realtime; this is the M1.1 placeholder that
 * proves the app renders and that `@customs/core` resolves from the app.
 */
export default function TonightPage() {
  return (
    <main>
      <h1>Customs Night</h1>
      <p>Nothing tonight yet.</p>
      <ul>
        {ROLES.map((role) => (
          <li key={role}>{role}</li>
        ))}
      </ul>
    </main>
  );
}
