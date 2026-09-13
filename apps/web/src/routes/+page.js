// The dashboard is the landing screen of the console.
import { redirect } from '@sveltejs/kit';

export function load() {
  redirect(307, '/dashboard');
}
