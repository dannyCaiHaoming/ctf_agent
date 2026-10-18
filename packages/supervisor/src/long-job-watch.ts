import { EventEmitter } from 'node:events';
import type { ToolRuntime, RuntimeOwner, JobRecord } from '@ctf/runtime';
import type { LongJobTerminalState, LongJobWatch, StateStore } from '@ctf/state';

/** Event-driven bridge from managed jobs to durable State/outbox continuations. */
export class DurableJobWatchService {
  private readonly events = new EventEmitter();
  private readonly unsubscribe: () => void;

  constructor(private readonly runtime: ToolRuntime, private readonly state: StateStore) {
    this.unsubscribe = runtime.onTerminal(event => {
      if (event.kind !== 'job') return;
      this.commit(event.resourceId, event.state, event.record.endCursor, event);
    });
  }

  async watch(input: { jobId: string; taskId: string; experimentId: string; cursor: number; continuationRef: string; deadline: string; owner: RuntimeOwner }): Promise<LongJobWatch> {
    const record = this.runtime.jobStatus(input.jobId, input.owner);
    if (!record || record.taskId !== input.taskId) throw new Error('job/task ownership mismatch');
    if (input.cursor > record.endCursor) throw new Error('watch cursor beyond job stream end');
    const saved = this.state.watchLongJob({ jobId: input.jobId, taskId: input.taskId, experimentId: input.experimentId,
      cursor: input.cursor, continuationRef: input.continuationRef, deadline: input.deadline });
    if (record.status !== 'running') this.commit(record.id, terminalState(record), record.endCursor, record);
    return this.state.longJobWatch(saved.jobId)!;
  }

  private commit(jobId: string, state: LongJobTerminalState, cursor: number, payload: unknown): void {
    const watch = this.state.longJobWatch(jobId);
    if (!watch) return;
    const eventId = `job-terminal:${jobId}:${state}:${cursor}`;
    this.state.commitLongJobTerminal({ runId: watch.runId, jobId, eventId, state, cursor, payload });
    this.events.emit(jobId);
  }

  /** Sleeps on host events, never on a model polling loop. Deadline cancels the job and follows its terminal branch. */
  async awaitContinuation(jobId: string, owner: RuntimeOwner): Promise<LongJobWatch> {
    const watch = this.state.longJobWatch(jobId);
    if (!watch) throw new Error('long job watch not found');
    if (watch.terminalEventId) return watch;
    const record = this.runtime.jobStatus(jobId, owner);
    if (!record || record.status !== 'running') {
      if (record) this.commit(jobId, terminalState(record), record.endCursor, record);
      else throw new Error('watched job is unavailable');
      return this.state.longJobWatch(jobId)!;
    }
    const remaining = Date.parse(watch.deadline) - Date.now();
    if (remaining <= 0) {
      await this.runtime.jobCancel(jobId, 'timeout', owner);
      return this.state.longJobWatch(jobId)!;
    }
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); this.events.off(jobId, check); resolve(); } };
      const check = () => { if (this.state.longJobWatch(jobId)?.terminalEventId) finish(); };
      const timer = setTimeout(() => {
        void this.runtime.jobCancel(jobId, 'timeout', owner).then(finish, error => { if (!done) { done = true; this.events.off(jobId, check); reject(error); } });
      }, remaining);
      this.events.on(jobId, check);
      // Close the race between checking the durable state and subscribing.
      check();
    });
    return this.state.longJobWatch(jobId)!;
  }

  claimContinuation(jobId: string): LongJobWatch { return this.state.claimLongJobContinuation(jobId); }
  dispose(): void { this.unsubscribe(); this.events.removeAllListeners(); }
}

function terminalState(record: JobRecord): LongJobTerminalState {
  return record.status === 'completed' ? 'completed' : record.status === 'cancelled' ? 'cancelled' : record.status === 'lost' ? 'lost' : 'error';
}
