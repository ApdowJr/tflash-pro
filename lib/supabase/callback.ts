import { cookies } from "next/headers";
import { stageCallbackCookies } from "./staged-callback";

export async function callbackSupabase() {
  const store = await cookies();
  return stageCallbackCookies({
    getAll: () => store.getAll(),
    setAll(changes) {
      for (const { name, value, options } of changes) store.set(name, value, options);
    },
  });
}
