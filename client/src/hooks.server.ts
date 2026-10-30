// Desktop auth lives in the Tauri store and the browser Supabase client.
// Do not share that client/session with SvelteKit server requests.
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = ({ event, resolve }) => resolve(event);
