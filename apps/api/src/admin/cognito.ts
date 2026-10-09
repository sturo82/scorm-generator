/*
 * Adapter sottile su Amazon Cognito per la gestione utenti admin (inviti).
 * Incapsula i Command dell'SDK e l'estrazione del `sub` generato, così il
 * service resta semplice e il client è iniettabile/mockabile.
 */
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  type CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

/** Errore sollevato quando l'utente esiste già in Cognito. */
export class CognitoUserExistsError extends Error {
  constructor() {
    super('Utente già esistente in Cognito');
    this.name = 'CognitoUserExistsError';
  }
}

export interface CreateCognitoUserInput {
  userPoolId: string;
  email: string;
  tenantId: string;
}

/**
 * Crea l'utente in Cognito (invia l'email di invito) e ritorna il `sub`
 * generato, che diventa l'externalId del record User nel DB.
 */
export async function adminCreateUser(
  client: CognitoIdentityProviderClient,
  input: CreateCognitoUserInput,
): Promise<{ sub: string }> {
  try {
    const out = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: input.userPoolId,
        Username: input.email,
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          { Name: 'email', Value: input.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:tenant_id', Value: input.tenantId },
        ],
      }),
    );
    const sub = out.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) {
      throw new Error('Cognito non ha restituito il sub del nuovo utente');
    }
    return { sub };
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      throw new CognitoUserExistsError();
    }
    throw err;
  }
}

/**
 * Elimina un utente da Cognito. Usato per la COMPENSAZIONE se la scrittura del
 * record User nel DB fallisce dopo la creazione in Cognito. Best-effort.
 */
export async function adminDeleteUser(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
  username: string,
): Promise<void> {
  await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
}
