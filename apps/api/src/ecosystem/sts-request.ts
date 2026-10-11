import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

/**
 * Richiesta `sts:GetCallerIdentity` PRE-FIRMATA (SigV4) da allegare al
 * self-register come campo `stsRequest`. Manager la ri-esegue verso STS per
 * ricavare l'ARN del nostro workload (prova d'identità senza segreti condivisi).
 *
 * Forma attesa da Manager: { url, method, headers, body }. Host STS **regionale**
 * (mai il globale `sts.amazonaws.com`). Va firmata AL MOMENTO della chiamata:
 * Manager accetta solo richieste con `X-Amz-Date` entro ~5 minuti.
 */
export interface SignedStsRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/**
 * Costruisce e firma la richiesta GetCallerIdentity con le credenziali del
 * ruolo di esecuzione del workload (default credential chain dell'SDK: su
 * Lambda/ECS/App Runner/EC2 le fornisce l'ambiente). Nessuna chiave statica.
 */
export async function buildSignedStsRequest(region: string): Promise<SignedStsRequest> {
  const host = `sts.${region}.amazonaws.com`; // SOLO regionale
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';

  const request = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname: host,
    path: '/',
    headers: {
      host,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const signer = new SignatureV4({
    service: 'sts',
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  return {
    url: `https://${host}/`,
    method: 'POST',
    headers: signed.headers,
    body,
  };
}
