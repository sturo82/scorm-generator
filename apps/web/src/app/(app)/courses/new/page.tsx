'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useCreateCourse } from '@/lib/api/hooks';

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

export default function NewCoursePage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateCourse();
  const [title, setTitle] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [description, setDescription] = React.useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length === 0) return;
    try {
      const course = await create.mutateAsync({ title: title.trim(), language, description: description.trim() });
      toast.show('Corso creato', 'success');
      router.push(`/courses/${course.id}`);
    } catch {
      toast.show('Creazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader title="Nuovo corso" description="Dai un nome al corso: definirai il brief subito dopo." />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="title">Titolo del corso</Label>
              <Input
                id="title"
                data-testid="course-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Sicurezza sul lavoro"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Lingua</Label>
              <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrizione (opzionale)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve descrizione del corso"
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit" data-testid="course-submit" disabled={create.isPending || !title.trim()}>
                {create.isPending ? 'Creazione…' : 'Crea e continua'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Annulla
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
