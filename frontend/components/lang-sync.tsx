"use client";

import { useEffect } from "react";
import { setApiLang } from "@/lib/api";
import { useLang } from "@/lib/i18n";

/** Keeps <html lang> and the API client's language in step with the one app-wide setting. */
export function LangSync() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
    setApiLang(lang);
  }, [lang]);
  return null;
}
