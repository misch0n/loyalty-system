/**
 * Short, accurate privacy notice + terms shown at registration. Template-style
 * (national DPA templates); the café is the data controller. Kept concise on
 * purpose. Rendered on demand (e.g. inside a sheet) when the customer taps the
 * "privacy notice" link, rather than always expanded.
 */

export function PrivacyNotice() {
  return (
    <div className="privacy">
      <h2 className="privacy-title">Privacy notice &amp; terms</h2>
      <ul>
        <li>
          <strong>What we collect:</strong> any name, email or phone you choose
          to give. All of it is optional — you can stay anonymous.
        </li>
        <li>
          <strong>Why:</strong> your details only enable card recovery and
          (later) reward notifications. Your loyalty points are tied to a random
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
          delete your data at any time.
        </li>
        <li>
          <strong>Wallet passes</strong> (when available) may involve Apple or
          Google and an international data transfer.
        </li>
      </ul>
    </div>
  );
}
