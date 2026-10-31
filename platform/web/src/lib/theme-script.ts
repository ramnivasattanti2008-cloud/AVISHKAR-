/**
 * The inline script that applies the saved theme before first paint, so a reader who chose dark does not get a white
 * flash while React starts. It is kept out of the layout so what the browser runs is one plain string that can be read
 * and reasoned about on its own.
 *
 * It runs by the request's nonce, which the root layout puts on the tag (see `src/proxy.ts`). It used to be allowed by a
 * SHA-256 hash listed in the policy instead; that was dropped because the same policy has to admit Next's own hydration
 * scripts, whose contents differ per page and per build, and no fixed list of hashes can cover those.
 *
 * It reads and writes only localStorage under our own key and never touches the network.
 */

/** The exact bytes the browser runs. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("avk-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
