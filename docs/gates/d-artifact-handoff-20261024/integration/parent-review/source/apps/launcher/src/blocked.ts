export class Blocked extends Error {
  constructor(reason: string) { super(`blocked_configuration: ${reason}`); }
}
