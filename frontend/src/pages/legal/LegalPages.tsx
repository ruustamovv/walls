/**
 * Legal + fair-play pages. Plain-language templates — have counsel review
 * before operating in any specific jurisdiction.
 */
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/primitives.js';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 720, display: 'grid', gap: 16 }}>
      <Link to="/" style={{ color: 'var(--muted)', fontSize: 14 }}>← Home</Link>
      <h1 className="font-display" style={{ margin: 0 }}>{title}</h1>
      <Card>
        <div style={{ display: 'grid', gap: 12, fontSize: 15, lineHeight: 1.6 }}>{children}</div>
      </Card>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Template text — requires legal review before production use.
      </p>
    </div>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms of Service">
      <p>Play fair: no engine assistance in rated games, no automation, no account sharing, no match collusion.</p>
      <p>Accounts engaging in cheating, abuse, spam or exploitation may be warned, suspended or banned, with appeals reviewed by moderators.</p>
      <p>Ratings, replays and tournament records are platform data used for rankings and integrity.</p>
      <p>Premium purchases (when enabled) grant entitlements only — never competitive advantage.</p>
    </Shell>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy Policy">
      <p>We store what the game needs: account identity, game records, ratings, chats you send, and moderation reports.</p>
      <p>Profiles and replays follow your visibility settings. You can request export or deletion of your personal data at any time.</p>
      <p>We never sell personal data. AI features process your game facts with configured providers under their terms.</p>
    </Shell>
  );
}

export function FairPlayPage() {
  return (
    <Shell title="Fair Play">
      <p><strong>No assistance in rated games.</strong> No engines, hints, bots-as-you, or second screens deciding moves.</p>
      <p><strong>No automation.</strong> One human per account per game. No scripts placing moves or farming.</p>
      <p><strong>No collusion.</strong> No arranged results, rating manipulation, or smurf-boosting.</p>
      <p>Enforcement is evidence-based: server clocks, timing signals, engine-similarity analysis and human review. Nothing you can buy changes the odds of a single game.</p>
      <p>See something? Report from any game or profile — every report reaches the moderation queue.</p>
    </Shell>
  );
}
