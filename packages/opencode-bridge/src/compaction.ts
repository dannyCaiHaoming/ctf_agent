import { restoreCompactionSession } from '@ctf/supervisor';

/** Host-driven compaction adapter. It allocates a new registry/context, never a provider/native session claim. */
export class LocalCompactionAdapter {
  async recreate(options: Parameters<typeof restoreCompactionSession>[0]) {
    const session = await restoreCompactionSession(options);
    return { workingSet: session.workingSet, sessionId: session.sessionId, context: session.context,
      readObservation: (id: string) => session.readObservation(id), host: session };
  }
}
