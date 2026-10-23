/**
 * The inline script that applies the saved theme before first paint. It is kept separate from the layout so its content
 * never changes: a static hash can be put in the CSP, which is what a nonce policy cannot do for a script that is the same
 * on every render.
 *
 * It reads and writes only localStorage under our own key and never touches the network, so a hash is safe here.
 */

/** The exact bytes the browser runs. Changing this invalidates the hash below. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("avk-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** SHA-256 of THEME_SCRIPT, base64, prefixed for the CSP source list. Computed once; do not hand-edit. */
export const THEME_SCRIPT_HASH = "sha256-CziUIgdwQiAXOHBEaXV2OraoUnQkXqcY/0vH3bIKftk=";
