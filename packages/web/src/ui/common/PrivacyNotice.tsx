/**
 * Short, accurate privacy notice + terms shown at registration. Template-style
 * (national DPA templates); the café is the data controller. Kept concise on
 * purpose. Name and email are both required (SCOPE-DECISIONS §2.1), so the
 * notice says what we hold and why — there is no anonymous tier to warn about
 * (§2.2). Rendered on demand (e.g. inside a sheet) when the customer taps the
 * "privacy notice" link, rather than always expanded.
 */

export function PrivacyNotice() {
  return (
    <div className="privacy">
      <h2 className="privacy-title">Privacy notice &amp; terms</h2>
      <ul>
        <li>
          <strong>What we collect:</strong> your name and your email address.
          Both are needed to make a card; we collect nothing else.
        </li>
        <li>
          <strong>Why:</strong> your name lets us greet you and lets staff find
          your card. Your email is where we send a code to get your card back,
          and a note when a reward is ready. Your points are tied to a random
          code, not to your identity.
        </li>
        <li>
          <strong>Lawful basis:</strong> your consent to join this opt-in scheme.
        </li>
        <li>
          <strong>Controller:</strong> this café holds your data and decides how
          it's used.
        </li>
        <li>
          <strong>Your rights:</strong> you can ask staff to view, correct, or
          delete your data at any time, or delete your card yourself from its
          menu.
        </li>
      </ul>
    </div>
  );
}
