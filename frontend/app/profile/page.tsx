"use client";

import Link from "next/link";
import { ArrowRight, Languages, Lock } from "lucide-react";
import { InfoTip } from "@/components/declutter";
import { LangSwitch } from "@/components/lang-switch";
import { ProfileChips } from "@/components/profile-chips";
import { AppShell, PageTitle } from "@/components/shell";
import { HowItWorksButton } from "@/components/tutorial/how-it-works";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useHydrated, useTrip } from "@/lib/store";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";

export default function ProfilePage() {
  const hydrated = useHydrated();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);
  const t = useT().t.profile;

  if (!hydrated) return <AppShell>{null}</AppShell>;
  const p = profile ?? DEMO_PROFILE;

  return (
    <AppShell>
      <PageTitle eyebrow={t.eyebrow} title={t.title}>
        {t.intro}{" "}
        <InfoTip>
          <span className="flex items-start gap-1.5">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t.aiNote}
          </span>
        </InfoTip>
      </PageTitle>

      <ProfileChips
        profile={p}
        onChange={(next) => {
          setProfile(next); // also invalidates cached recs: taste fit depends on the profile
        }}
      />

      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Languages className="size-4 text-pine" aria-hidden /> {t.languageTitle}
        </p>
        <LangSwitch size="md" />
      </div>

      <Button asChild size="lg" className="mt-6 h-12 w-full rounded-2xl text-base">
        <Link href="/windows">
          {t.continue} <ArrowRight data-icon="inline-end" />
        </Link>
      </Button>

      <HowItWorksButton className="mt-8" />
    </AppShell>
  );
}
