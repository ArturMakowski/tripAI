"use client";

import { useRef, useState } from "react";
import { DnaResult } from "@/components/dna-result";
import { api, USER_ID } from "@/lib/api";
import { collectAnswers, DNA_DECK, type DnaCard } from "@/lib/dna";
import { profileFromDna } from "@/lib/first-run";
import { useT } from "@/lib/i18n";
import { useTrip } from "@/lib/store";

/**
 * The full Travel DNA result in Profile (T19: no longer a stop in onboarding). Editing an answer recomputes
 * the result and applies it at once (profile + weights), keeping the airports, party and budget set here;
 * the trips list re-ranks on the next visit.
 */
export function DnaProfile() {
  const { lang } = useT();
  const { deck, setDeck, profile, setProfile, setWeights, setMode } = useTrip();
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  if (!deck.result || deck.swipes.length < DNA_DECK.length) return null;
  const collected = collectAnswers(deck.swipes);

  async function edit(cardId: string, value: number | boolean) {
    const next = [...deck.swipes.filter((s) => s.id !== cardId), { id: cardId as DnaCard["id"], value }];
    // keep deck order, like the deck itself
    next.sort((a, b) => DNA_DECK.findIndex((c) => c.id === a.id) - DNA_DECK.findIndex((c) => c.id === b.id));
    setDeck({ swipes: next });
    const id = ++reqId.current;
    setBusy(true);
    const edited = collectAnswers(next);
    try {
      const { data, mode } = await api.profileDna({
        user_id: USER_ID,
        answers: edited.answers as Record<string, number>,
        yes_no: edited.yes_no as Record<string, boolean>,
      });
      if (id !== reqId.current) return; // a newer edit won
      setMode("interview", mode);
      setDeck({ result: data });
      setProfile(profileFromDna(data, useTrip.getState().profile ?? profile));
      setWeights(data.weights);
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }

  const airports = profile?.origin_airports ?? deck.airports;
  return (
    <section id="dna" className="mb-6 scroll-mt-20">
      <DnaResult result={deck.result} collected={collected} lang={lang} busy={busy} airports={airports} onEdit={edit} heading="h2" />
    </section>
  );
}
