import { redirect } from 'next/navigation';

/** /settings reindirizza alla prima scheda dell'area Impostazioni (Avatar). */
export default function SettingsIndexPage() {
  redirect('/settings/avatars');
}
