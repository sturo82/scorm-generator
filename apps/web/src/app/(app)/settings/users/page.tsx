'use client';

import * as React from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useUsers, useCreateUser } from '@/lib/api/hooks';
import { getSession } from '@/lib/auth';
import type { AppUserRole } from '@/lib/api/types';

/** Gerarchia ruoli (coerente con il backend). */
const ROLE_RANK: Record<AppUserRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };
const ROLE_LABEL: Record<AppUserRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

function isRole(v: string | undefined): v is AppUserRole {
  return v === 'OWNER' || v === 'ADMIN' || v === 'EDITOR' || v === 'VIEWER';
}

/**
 * Pannello admin: elenco utenti del tenant e invito di nuovi utenti. L'invito
 * crea l'utente in Cognito (email con password temporanea) e il record nel DB.
 * La select del ruolo offre solo ruoli ≤ quello dell'utente corrente. L'accesso
 * reale è protetto server-side (@Roles ADMIN); qui il gating è cosmetico.
 */
export default function UsersSettingsPage() {
  const toast = useToast();
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();

  const sessionRole = getSession()?.user.role;
  const myRole: AppUserRole = isRole(sessionRole) ? sessionRole : 'VIEWER';
  const assignableRoles = (['ADMIN', 'EDITOR', 'VIEWER'] as AppUserRole[]).filter(
    (r) => ROLE_RANK[r] <= ROLE_RANK[myRole],
  );

  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [role, setRole] = React.useState<AppUserRole>('VIEWER');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid) {
      toast.show('Inserisci un indirizzo email valido', 'error');
      return;
    }
    try {
      await createUser.mutateAsync({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        role,
      });
      toast.show('Invito inviato: l’utente riceverà un’email', 'success');
      setEmail('');
      setDisplayName('');
      setRole('VIEWER');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /già esist|409/.test(msg)
          ? 'Esiste già un utente con questa email'
          : 'Invito non riuscito',
        'error',
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Utenti"
        description="Invita i membri del tuo team e assegna loro un ruolo. L’invitato riceve un’email per impostare la password."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Elenco utenti */}
        <Card>
          <CardHeader>
            <CardTitle>Utenti del tenant</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Caricamento…
              </div>
            ) : (users?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun utente ancora.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Ruolo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users!.map((u) => (
                      <tr key={u.id}>
                        <td className="px-3 py-2">{u.email}</td>
                        <td className="px-3 py-2 text-muted-foreground">{u.displayName ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {ROLE_LABEL[u.role]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Form invito */}
        <Card className="h-max">
          <CardHeader>
            <CardTitle>Invita utente</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleInvite}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  placeholder="nome@azienda.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
                {email.length > 0 && !emailValid && (
                  <p className="text-xs text-destructive">Email non valida.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Nome (opzionale)</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  maxLength={120}
                  placeholder="Mario Rossi"
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Ruolo</Label>
                <Select id="role" value={role} onChange={(e) => setRole(e.target.value as AppUserRole)}>
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={!emailValid || createUser.isPending} className="w-full">
                {createUser.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Invia invito
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
