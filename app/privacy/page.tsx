import Link from "next/link";

export const runtime = "nodejs";

export default function PrivacyPage() {
  return (
    <main className="container">
      <p><Link href="/">← NEON Podcasts</Link></p>
      <h1>Privacy Policy</h1>
      <p>Last updated: November 24, 2026</p>

      <h2>What we collect</h2>
      <p>
        When you sign in with Google, NEON Podcasts receives your Google account email address and name. The account
        record uses your email to identify you. We also store API tokens issued for your app, devices, or agents, and
        content you create in the service, including shows, briefings, generated episodes, and follows.
      </p>

      <h2>How we use information</h2>
      <p>
        We use this information to authenticate you, provide the podcast and agent features you request, maintain
        your account, deliver your follows, and protect the service. AI is used to generate episode scripts and audio
        when you request generation. The generated content is stored as part of your account content.
      </p>

      <h2>Sharing and retention</h2>
      <p>
        We do not sell your personal information. We retain account data and content until you delete your account,
        unless a longer period is required to comply with law or resolve a security or abuse issue. Public shows and
        feeds may be accessible to people who have their links while they remain public.
      </p>

      <h2>Your choices</h2>
      <p>
        You can revoke API tokens in Settings. You can permanently delete your account from Settings on the website
        or from Settings in the mobile app. Account deletion removes your account, tokens, subscriptions, shows, and
        related content. Owner accounts must transfer or delete shared shows before deletion.
      </p>

      <h2>Contact</h2>
      <p>For privacy questions, contact the NEON Podcasts team through the support contact published with the app listing.</p>
    </main>
  );
}
