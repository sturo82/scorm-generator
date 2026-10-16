import { SettingsTabs } from './settings-tabs';

/**
 * Layout dell'area Impostazioni: raccoglie Avatar, Branding e Utenti sotto una
 * navigazione a tab condivisa. Ogni sotto-pagina rende solo il proprio
 * contenuto; l'intestazione resta nelle singole pagine.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SettingsTabs />
      {children}
    </div>
  );
}
