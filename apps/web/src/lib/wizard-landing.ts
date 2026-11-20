/**
 * Alla fine di una generazione automatica l'utente arriva sull'anteprima del corso: la schermata di
 * avanzamento lascia questa chiave e il wizard del corso la legge una volta sola per aprire lo
 * step "Anteprima & Export".
 */
export const wizardLandingKey = (courseId: string): string => `course-wizard-landing:${courseId}`;
