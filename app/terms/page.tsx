import Link from "next/link";

export const runtime = "nodejs";

export default function TermsPage() {
  return (
    <main className="container">
      <p><Link href="/">← NEON Podcasts</Link></p>
      <h1>Terms of Service</h1>
      <p>Last updated: November 24, 2026</p>

      <h2>Using NEON Podcasts</h2>
      <p>
        NEON Podcasts lets signed-in users create and manage podcast shows, briefings, episodes, follows, and API
        tokens for apps or agents. You must use the service lawfully, keep your account and tokens secure, and not
        use the service to abuse, disrupt, or gain unauthorized access to anyone else's data.
      </p>

      <h2>Your content</h2>
      <p>
        You are responsible for the content you submit or create, including show descriptions, briefings, scripts,
        and episodes. You must have the rights needed to provide that content. You retain responsibility for reviewing
        AI-generated scripts and audio before publishing or sharing them.
      </p>

      <h2>AI-generated audio</h2>
      <p>
        NEON may use AI to generate episode scripts and audio at your request. AI output can be incomplete or
        inaccurate. You are responsible for checking it and for how you publish or use it.
      </p>

      <h2>Accounts and deletion</h2>
      <p>
        Sign-in uses Google. You may revoke tokens in Settings and delete your account from the website or mobile app.
        Deletion is permanent and removes your account, tokens, subscriptions, shows, and related content. Owner
        accounts must transfer or delete shared shows before deletion.
      </p>

      <h2>Service changes</h2>
      <p>
        We may change, suspend, or discontinue features. We may restrict access when needed to protect the service or
        its users. These terms apply to your use of the service; continued use after an update means you accept the
        updated terms.
      </p>

      <h2>Contact</h2>
      <p>For questions about these terms, contact the NEON Podcasts team through the support contact published with the app listing.</p>
    </main>
  );
}
