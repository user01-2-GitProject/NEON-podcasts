import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; registered?: string; next?: string }>;
}) {
  const { error, registered, next } = await searchParams;
  return <LoginForm error={error} registered={Boolean(registered)} next={next} />;
}
