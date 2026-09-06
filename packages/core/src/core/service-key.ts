const SERVICE_KEY_BRAND = Symbol('ServiceKey');

export interface ServiceKey<T> {
  readonly _brand: (value: T) => T;
  readonly name: string;
  readonly id: symbol;
  /** @internal — runtime brand check */
  readonly [SERVICE_KEY_BRAND]: true;
}

export function createServiceKey<T>(name: string): ServiceKey<T> {
  return {
    [SERVICE_KEY_BRAND]: true,
    _brand: ((value: unknown) => value) as (value: T) => T,
    name,
    id: Symbol(name),
  };
}
