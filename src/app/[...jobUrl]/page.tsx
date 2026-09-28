import { notFound, redirect } from "next/navigation";

// resume.buzz/https://jobs.example.com/role → start tailoring that posting.
export default async function PrefixedUrl({ params, searchParams }: PageProps<"/[...jobUrl]">) {
  const { jobUrl } = await params;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const val of Array.isArray(v) ? v : [v ?? ""]) qs.append(k, val);
  }

  // Browsers/proxies collapse "https://" to "https:/" in paths; restore it.
  let target = jobUrl.map(decodeURIComponent).join("/").replace(/^(https?):\/*/i, "$1://");
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  if (qs.size) target += `?${qs}`;

  try {
    const u = new URL(target);
    if (!u.hostname.includes(".")) notFound();
  } catch {
    notFound();
  }
  redirect(`/?url=${encodeURIComponent(target)}`);
}
