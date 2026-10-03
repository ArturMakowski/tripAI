"use client";

import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { ProfileChips } from "@/components/profile-chips";
import { AppShell, PageTitle } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useHydrated, useTrip } from "@/lib/store";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";

export default function ProfilePage() {
  const hydrated = useHydrated();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);

  if (!hydrated) return <AppShell>{null}</AppShell>;
  const p = profile ?? DEMO_PROFILE;

  return (
    <AppShell>
      <PageTitle eyebrow="Taste profile" title="Here's what we heard.">
        This is everything the ranking knows about you. Change anything and your trips re-rank.
      </PageTitle>

      <ProfileChips
        profile={p}
        onChange={(next) => {
          setProfile(next); // also invalidates cached recs: taste fit depends on the profile
        }}
      />

      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        The AI turned your answers into this profile. The scores themselves come from a fixed formula over sourced data, and the AI
        never makes up a price.
      </p>

      <Button asChild size="lg" className="mt-6 h-12 w-full rounded-2xl text-base">
        <Link href="/windows">
          Looks right: find my free time <ArrowRight data-icon="inline-end" />
        </Link>
      </Button>
    </AppShell>
  );
}
