/**
 * Container di dependency injection minimale e framework-agnostico.
 * Permette di registrare gli adapter concreti dietro le porte via
 * configurazione, senza che la logica di dominio conosca le implementazioni
 * (Requisito 10.1 / 10.3). NestJS, se usato nell'API, può delegare a questo
 * registry oppure replicarne la registrazione tramite i propri provider.
 */

/** Token tipizzato che lega una chiave a un tipo di servizio. */
export interface Token<T> {
  readonly key: symbol;
  /** Solo per inferenza del tipo; non valorizzato a runtime. */
  readonly _type?: T;
}

export function createToken<T>(description: string): Token<T> {
  return { key: Symbol(description) };
}

type Factory<T> = (c: Container) => T;

export class Container {
  private readonly singletons = new Map<symbol, unknown>();
  private readonly factories = new Map<symbol, Factory<unknown>>();

  /** Registra un'istanza già creata. */
  registerValue<T>(token: Token<T>, value: T): this {
    this.singletons.set(token.key, value);
    return this;
  }

  /** Registra una factory lazy; l'istanza è creata e memorizzata al primo resolve. */
  registerFactory<T>(token: Token<T>, factory: Factory<T>): this {
    this.factories.set(token.key, factory as Factory<unknown>);
    return this;
  }

  has<T>(token: Token<T>): boolean {
    return this.singletons.has(token.key) || this.factories.has(token.key);
  }

  resolve<T>(token: Token<T>): T {
    if (this.singletons.has(token.key)) {
      return this.singletons.get(token.key) as T;
    }
    const factory = this.factories.get(token.key);
    if (!factory) {
      throw new Error(`Nessuna registrazione per il token: ${String(token.key.description)}`);
    }
    const instance = factory(this) as T;
    this.singletons.set(token.key, instance);
    return instance;
  }
}
