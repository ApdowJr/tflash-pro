import { createServerClient, type GetAllCookies, type SetAllCookies } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./config";

type CookieBatch = Parameters<SetAllCookies>[0];

/**
 * Exchange link codes without immediately writing their session to the app.
 * A recovery link needs a session to update the password, but a legacy signup
 * link must only confirm the address and then return to password sign-in.
 */
export function stageCallbackCookies(methods: { getAll: GetAllCookies; setAll: SetAllCookies }) {
  const staged: CookieBatch = [];
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: methods.getAll,
      setAll(changes) { staged.push(...changes); },
    },
  });

  async function commit(verifiersOnly: boolean) {
    // Preserve PKCE cleanup and the concurrent-flow index without ever sending
    // the signup exchange's temporary auth session to the browser.
    const changes = verifiersOnly
      ? staged.filter(({ name }) => /-code-verifier(?:\.\d+)?$/.test(name))
      : staged.slice();
    staged.length = 0;
    if (changes.length) await methods.setAll(changes, {});
  }

  return {
    supabase,
    commitRecovery: () => commit(false),
    commitVerifiers: () => commit(true),
  };
}
